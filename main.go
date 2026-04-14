// =============================================================================
// Tekno Tracker Cluster — Merkezi Izleme ve Kontrol Sistemi
// 15 PlantManager'dan paralel veri toplayarak 3840 solar tracker'i
// tek ekrandan izleme ve toplu mod/aci/zaman yazma.
// Windows'ta calisir, konsol penceresi acmaz.
//
// Designed and Written by Muhammed Hasan GUCLU - 2026
// =============================================================================

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Config — Uygulama yapilandirma yapilari ve fonksiyonlari
// ---------------------------------------------------------------------------

// PMCfg: Tek bir PlantManager'in isim ve IP bilgisini tutar.
type PMCfg struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
}

// AppConfig: Tum uygulama ayarlarini icerir — port, poll suresi, PM listesi.
type AppConfig struct {
	Port         int       `json:"port"`
	PollInterval int       `json:"poll_interval"` // seconds
	PlantManagers        []PMCfg `json:"plant_managers"`
}

// Global degiskenler: config thread-safe erisim icin mutex ile korunur.
// configDir calisma dizinini tutar (exe yanindaki config.json icin).
var (
	config    AppConfig
	configMu  sync.RWMutex
	configDir string
)

// defaultConfig: Varsayilan yapilandirmayi olusturur.
// 192.168.5.101-115 araliginda 15 PlantManager tanimlar.
func defaultConfig() AppConfig {
	pms := []PMCfg{}
	for i := 101; i <= 115; i++ {
		pms = append(pms, PMCfg{
			Name: fmt.Sprintf("PlantManager-%d", i),
			IP:   fmt.Sprintf("192.168.5.%d", i),
		})
	}
	return AppConfig{
		Port:         8095,
		PollInterval: 60,
		PlantManagers:        pms,
	}
}

// configPath: config.json dosyasinin tam yolunu dondurur.
func configPath() string { return filepath.Join(configDir, "config.json") }

// loadConfig: Diskten config.json okur.
// Dosya yoksa veya parse edilemezse varsayilan ayarlarla baslar.
func loadConfig() {
	data, err := os.ReadFile(configPath())
	if err != nil {
		// Dosya bulunamadi — varsayilan config ile baslat ve diske yaz
		config = defaultConfig()
		saveConfig()
		return
	}
	if err := json.Unmarshal(data, &config); err != nil {
		// JSON parse hatasi — varsayilana don
		config = defaultConfig()
	}
	// PM listesi bossa varsayilana geri don ve kaydet
	if len(config.PlantManagers) == 0 {
		config = defaultConfig()
		saveConfig()
	}
}

// saveConfig: Mevcut config'i JSON olarak diske yazar.
func saveConfig() {
	os.MkdirAll(configDir, 0755)
	data, _ := json.MarshalIndent(config, "", "  ")
	os.WriteFile(configPath(), data, 0644)
}

// ---------------------------------------------------------------------------
// Data cache — PlantManager verilerinin bellekte tutuldugu yapilar
// ---------------------------------------------------------------------------

// DeviceData: Tek bir tracker cihazinin anlик durumunu tutar.
// Mode: calisma modu, Angle: aci (derece), Time: cihaz saati.
type DeviceData struct {
	Mode  *int    `json:"mode"`
	Angle *int    `json:"angle"`
	Time  string  `json:"time"`
	Error bool    `json:"error"`
}

// OmegaData: Bir Omega kontrolcusunun altindaki tum cihazlarin verisi.
// Her Omega 16'ya kadar tracker cihazi yonetir.
type OmegaData struct {
	ID          int          `json:"id"`
	Name        string       `json:"name"`
	IP          string       `json:"ip"`
	DeviceCount int          `json:"device_count"`
	Devices     []DeviceData `json:"devices"`
	Online      bool         `json:"online"`
	Cached      bool         `json:"cached,omitempty"`
	CacheTs     string       `json:"cache_ts,omitempty"`
	CacheAge    int          `json:"cache_age,omitempty"`
}

// PMSnapshot: Bir PlantManager'in tum Omega'lariyla birlikte anlик goruntusunu tutar.
type PMSnapshot struct {
	Name       string      `json:"name"`
	IP         string      `json:"ip"`
	Omegas     []OmegaData `json:"omegas"`
	Online     bool        `json:"online"`
	LastUpdate string      `json:"last_update"`
}

// clusterData: Tum PlantManager'larin son poll sonuclarini tutan global cache.
// clusterDataMu ile esanli erisim korunur.
var (
	clusterData   []PMSnapshot
	clusterDataMu sync.RWMutex
)

// ---------------------------------------------------------------------------
// Fetcher — PlantManager API'lerinden veri cekme fonksiyonlari
// ---------------------------------------------------------------------------

// httpClient: Tum disari HTTP isteklerinde kullanilan istemci.
// 15sn timeout — yavas/erisilemeyen PM'lerde takilmayi onler.
var httpClient = &http.Client{Timeout: 15 * time.Second}

// fetchJSON: Verilen URL'den GET istegi yapar ve sonucu target yapisina parse eder.
func fetchJSON(url string, target interface{}) error {
	resp, err := httpClient.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, target)
}

// inclinationToDegrees: Inclinometre ham degerini (16-bit signed, 32768 olcekli)
// derece cinsinden aciya cevirir. Asin fonksiyonu kullanilir cunku
// sensorden gelen deger sin(aci) karsiligi normalize bir degerdir.
func inclinationToDegrees(val int) int {
	inc := float64(val) / 32768.0
	// Sinir kontrolu: asin fonksiyonu [-1, 1] disinda tanimsiz
	if inc > 1.0 {
		inc = 1.0
	}
	if inc < -1.0 {
		inc = -1.0
	}
	return int(math.Round(math.Asin(inc) * 180.0 / math.Pi))
}

// pollOnePM: Tek bir PlantManager'dan tum Omega ve cihaz verilerini ceker.
// Once /api/omegas ile Omega listesini alir, sonra her Omega icin
// /api/omega/{id}/cache/data ile cihaz verilerini toplar.
func pollOnePM(pm PMCfg) PMSnapshot {
	snap := PMSnapshot{
		Name:       pm.Name,
		IP:         pm.IP,
		LastUpdate: time.Now().Format("15:04:05"),
	}

	baseURL := fmt.Sprintf("http://%s:8090", pm.IP)

	// Ilk adim: PM'den bagli Omega listesini al
	var omegas []struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		IP          string `json:"ip"`
		DeviceCount int    `json:"device_count"`
	}
	if err := fetchJSON(baseURL+"/api/omegas", &omegas); err != nil {
		// PM'e erisilemedi — offline olarak isaretle
		snap.Online = false
		return snap
	}
	snap.Online = true

	// Her Omega icin cihaz verilerini cek
	for _, o := range omegas {
		od := OmegaData{
			ID:          o.ID,
			Name:        o.Name,
			IP:          o.IP,
			DeviceCount: o.DeviceCount,
		}
		dc := o.DeviceCount
		if dc == 0 {
			// Cihaz sayisi bildirilmemisse varsayilan 16 kullan
			dc = 16
		}

		// Omega'nin cache'lenmi veri endpoint'ini sorgula
		var cacheResp struct {
			Success  bool                       `json:"success"`
			Data     map[string]json.RawMessage `json:"data"`
			Cached   bool                       `json:"_cached"`
			CacheTs  string                     `json:"_cache_ts"`
			CacheAge int                        `json:"_cache_age"`
		}
		cacheURL := fmt.Sprintf("%s/api/omega/%d/cache/data", baseURL, o.ID)
		if err := fetchJSON(cacheURL, &cacheResp); err != nil || !cacheResp.Success {
			// Cache alinamadi — tum cihazlari hatali olarak isaretle
			od.Online = false
			od.Devices = make([]DeviceData, dc)
			for i := range od.Devices {
				od.Devices[i] = DeviceData{Error: true}
			}
			snap.Omegas = append(snap.Omegas, od)
			continue
		}

		od.Online = true
		od.Cached = cacheResp.Cached
		od.CacheTs = cacheResp.CacheTs
		od.CacheAge = cacheResp.CacheAge
		od.Devices = make([]DeviceData, dc)

		// Her cihazin Modbus register verilerini isle
		for dev := 0; dev < dc; dev++ {
			key := fmt.Sprintf("%d", dev)
			raw, ok := cacheResp.Data[key]
			if !ok {
				// Bu cihaz icin cache'de veri yok
				od.Devices[dev] = DeviceData{Error: true}
				continue
			}
			var devCache struct {
				Input   []int `json:"input"`
				Holding []int `json:"holding"`
				Error   bool  `json:"error"`
			}
			if err := json.Unmarshal(raw, &devCache); err != nil || devCache.Error {
				od.Devices[dev] = DeviceData{Error: true}
				continue
			}

			dd := DeviceData{}
			// Holding[0] = calisma modu (Astronom, Wind, Snow vb.)
			if len(devCache.Holding) > 0 {
				m := devCache.Holding[0]
				dd.Mode = &m
			}
			// Input[5] = inclinometre ham degeri — dereceye cevir
			if len(devCache.Input) > 5 {
				a := inclinationToDegrees(devCache.Input[5])
				dd.Angle = &a
			}
			// Holding[6]=saat, Holding[7]=dakika — cihaz saati
			if len(devCache.Holding) > 7 {
				dd.Time = fmt.Sprintf("%02d:%02d", devCache.Holding[6], devCache.Holding[7])
			}
			od.Devices[dev] = dd
		}
		snap.Omegas = append(snap.Omegas, od)
	}
	return snap
}

// pollAllPlantManagers: Tum PM'leri paralel olarak sorgular.
// Her PM icin ayri goroutine baslatir, sonuclari toplar ve global cache'i gunceller.
func pollAllPlantManagers() {
	// Config'den PM listesinin kopyasini al (lock suresi kisa tutulur)
	configMu.RLock()
	pms := make([]PMCfg, len(config.PlantManagers))
	copy(pms, config.PlantManagers)
	configMu.RUnlock()

	// Paralel sorgulama — her PM icin ayri goroutine
	results := make([]PMSnapshot, len(pms))
	var wg sync.WaitGroup
	for i, p := range pms {
		wg.Add(1)
		go func(idx int, pm PMCfg) {
			defer wg.Done()
			results[idx] = pollOnePM(pm)
		}(i, p)
	}
	wg.Wait()

	// Global cache'i guncelle — yazma kilidi ile
	clusterDataMu.Lock()
	clusterData = results
	clusterDataMu.Unlock()
	log.Printf("[POLL] %d PlantManager polled", len(results))
}

// startPoller: Arka planda periyodik sorgulama dongusu baslatir.
// Ilk poll hemen yapilir, sonra config'teki aralıkla tekrar eder.
func startPoller() {
	go func() {
		// Baslangicta hemen bir poll yap
		pollAllPlantManagers()
		for {
			// Her dongude guncel interval'i oku (kullanici degistirebilir)
			configMu.RLock()
			interval := config.PollInterval
			configMu.RUnlock()
			// Minimum 5 saniye — cok sik sorgu yapmayi engelle
			if interval < 5 {
				interval = 5
			}
			time.Sleep(time.Duration(interval) * time.Second)
			pollAllPlantManagers()
		}
	}()
}

// ---------------------------------------------------------------------------
// HTTP Handlers — REST API endpoint fonksiyonlari
// ---------------------------------------------------------------------------

// writeJSONResp: Standart JSON response yazar. Content-Type header'i ayarlar.
func writeJSONResp(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// readBody: HTTP request body'sini okur ve JSON olarak parse eder.
// Hata durumunda nil dondurur.
func readBody(r *http.Request) map[string]interface{} {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		return nil
	}
	return m
}

// clusterHandler: GET /api/cluster — Tum PM snapshot verilerini JSON olarak dondurur.
// Frontend bu endpoint'i kullanarak grid gorunumunu olusturur.
func clusterHandler(w http.ResponseWriter, r *http.Request) {
	clusterDataMu.RLock()
	defer clusterDataMu.RUnlock()
	writeJSONResp(w, clusterData)
}

// pollHandler: POST /api/poll — Manuel poll tetikler.
// Arka planda calisirir ve hemen "ok" dondurur, frontend 2sn sonra yeniler.
func pollHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	go pollAllPlantManagers()
	writeJSONResp(w, map[string]bool{"ok": true})
}

// settingsHandler: GET/POST /api/settings — Ayarlari okuma ve guncelleme.
// GET: mevcut config'i dondurur.
// POST: poll_interval gibi ayarlari gunceller ve diske kaydeder.
func settingsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		configMu.RLock()
		writeJSONResp(w, config)
		configMu.RUnlock()
	case "POST":
		body := readBody(r)
		if body == nil {
			http.Error(w, "Body bos", 400)
			return
		}
		configMu.Lock()
		// Sadece poll_interval guncellenebilir (guvenlik icin sinirli)
		if v, ok := body["poll_interval"].(float64); ok {
			config.PollInterval = int(v)
		}
		saveConfig()
		configMu.Unlock()
		writeJSONResp(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "Method not allowed", 405)
	}
}

// brSettingsHandler: POST /api/br-settings — Background reader ayarlarini
// PlantManager uzerinden Omega'ya iletir. Bu, Omega'nin arka planda
// otomatik Modbus okuma yapip yapmayacagini ve aralіgini belirler.
func brSettingsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	body := readBody(r)
	if body == nil {
		http.Error(w, "Body bos", 400)
		return
	}

	// Request body'den PM IP, Omega ID, acik/kapali ve aralik bilgisini al
	pmIP, _ := body["pm_ip"].(string)
	omegaID := 0
	if v, ok := body["omega_id"].(float64); ok {
		omegaID = int(v)
	}
	enabled, _ := body["enabled"].(bool)
	interval := 60
	if v, ok := body["interval"].(float64); ok {
		interval = int(v)
	}

	// PM'in config endpoint'ine proxy istegi gonder
	url := fmt.Sprintf("http://%s:8090/api/omega/%d/config", pmIP, omegaID)
	payload, _ := json.Marshal(map[string]interface{}{
		"background_reader_enabled":  enabled,
		"background_reader_interval": interval,
	})

	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		writeJSONResp(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		writeJSONResp(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	defer resp.Body.Close()
	writeJSONResp(w, map[string]interface{}{"success": true})
}

// ---------------------------------------------------------------------------
// Main — Uygulama giris noktasi
// ---------------------------------------------------------------------------

func main() {
	// Calisma dizinini belirle: exe'nin bulundugu dizin kullanilir.
	// Bu sayede config.json ve static/ dosyalari exe ile ayni yerde aranir.
	exe, err := os.Executable()
	if err != nil {
		configDir, _ = os.Getwd()
	} else {
		configDir = filepath.Dir(exe)
	}

	// Yapilandirmayi yukle ve periyodik poll dongusu baslat
	loadConfig()
	startPoller()

	// HTTP router tanimla
	mux := http.NewServeMux()
	staticDir := filepath.Join(configDir, "static")

	// Statik dosyalar (JS, CSS, HTML) /static/ altindan sunulur
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))

	// API endpoint'leri
	mux.HandleFunc("/api/cluster", clusterHandler)
	mux.HandleFunc("/api/poll", pollHandler)
	mux.HandleFunc("/api/settings", settingsHandler)
	mux.HandleFunc("/api/br-settings", brSettingsHandler)

	// Kok yol icin index.html sun, diger yollar 404 dondurur
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})

	addr := fmt.Sprintf("0.0.0.0:%d", config.Port)
	log.Printf("Tekno Tracker Cluster starting on %s", addr)
	log.Printf("  PlantManagers: %d, Poll: %ds", len(config.PlantManagers), config.PollInterval)

	// CORS middleware — frontend farkli porttan erisebilsin diye
	// tum origin'lere izin verir. Preflight (OPTIONS) isteklerini de karsilar.
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(200)
			return
		}
		mux.ServeHTTP(w, r)
	})

	// Sunucuyu baslat — hata olursa log.Fatal ile cikis yapar
	log.Fatal(http.ListenAndServe(addr, handler))
}
