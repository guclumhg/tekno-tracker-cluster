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
// Config
// ---------------------------------------------------------------------------

type PMCfg struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
}

type AppConfig struct {
	Port         int       `json:"port"`
	PollInterval int       `json:"poll_interval"` // seconds
	PlantManagers        []PMCfg `json:"plant_managers"`
}

var (
	config    AppConfig
	configMu  sync.RWMutex
	configDir string
)

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

func configPath() string { return filepath.Join(configDir, "config.json") }

func loadConfig() {
	data, err := os.ReadFile(configPath())
	if err != nil {
		config = defaultConfig()
		saveConfig()
		return
	}
	if err := json.Unmarshal(data, &config); err != nil {
		config = defaultConfig()
	}
	if len(config.PlantManagers) == 0 {
		config = defaultConfig()
		saveConfig()
	}
}

func saveConfig() {
	os.MkdirAll(configDir, 0755)
	data, _ := json.MarshalIndent(config, "", "  ")
	os.WriteFile(configPath(), data, 0644)
}

// ---------------------------------------------------------------------------
// Data cache
// ---------------------------------------------------------------------------

type DeviceData struct {
	Mode  *int    `json:"mode"`
	Angle *int    `json:"angle"`
	Time  string  `json:"time"`
	Error bool    `json:"error"`
}

type OmegaData struct {
	ID          int          `json:"id"`
	Name        string       `json:"name"`
	IP          string       `json:"ip"`
	DeviceCount int          `json:"device_count"`
	Devices     []DeviceData `json:"devices"`
	Online      bool         `json:"online"`
}

type PMSnapshot struct {
	Name       string      `json:"name"`
	IP         string      `json:"ip"`
	Omegas     []OmegaData `json:"omegas"`
	Online     bool        `json:"online"`
	LastUpdate string      `json:"last_update"`
}

var (
	clusterData   []PMSnapshot
	clusterDataMu sync.RWMutex
)

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

var httpClient = &http.Client{Timeout: 15 * time.Second}

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

func inclinationToDegrees(val int) int {
	inc := float64(val) / 32768.0
	if inc > 1.0 {
		inc = 1.0
	}
	if inc < -1.0 {
		inc = -1.0
	}
	return int(math.Round(math.Asin(inc) * 180.0 / math.Pi))
}

func pollOnePM(pm PMCfg) PMSnapshot {
	snap := PMSnapshot{
		Name:       pm.Name,
		IP:         pm.IP,
		LastUpdate: time.Now().Format("15:04:05"),
	}

	baseURL := fmt.Sprintf("http://%s:8090", pm.IP)

	var omegas []struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		IP          string `json:"ip"`
		DeviceCount int    `json:"device_count"`
	}
	if err := fetchJSON(baseURL+"/api/omegas", &omegas); err != nil {
		snap.Online = false
		return snap
	}
	snap.Online = true

	for _, o := range omegas {
		od := OmegaData{
			ID:          o.ID,
			Name:        o.Name,
			IP:          o.IP,
			DeviceCount: o.DeviceCount,
		}
		dc := o.DeviceCount
		if dc == 0 {
			dc = 16
		}

		var cacheResp struct {
			Success bool                       `json:"success"`
			Data    map[string]json.RawMessage `json:"data"`
		}
		cacheURL := fmt.Sprintf("%s/api/omega/%d/cache/data", baseURL, o.ID)
		if err := fetchJSON(cacheURL, &cacheResp); err != nil || !cacheResp.Success {
			od.Online = false
			od.Devices = make([]DeviceData, dc)
			for i := range od.Devices {
				od.Devices[i] = DeviceData{Error: true}
			}
			snap.Omegas = append(snap.Omegas, od)
			continue
		}

		od.Online = true
		od.Devices = make([]DeviceData, dc)

		for dev := 0; dev < dc; dev++ {
			key := fmt.Sprintf("%d", dev)
			raw, ok := cacheResp.Data[key]
			if !ok {
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
			if len(devCache.Holding) > 0 {
				m := devCache.Holding[0]
				dd.Mode = &m
			}
			if len(devCache.Input) > 5 {
				a := inclinationToDegrees(devCache.Input[5])
				dd.Angle = &a
			}
			if len(devCache.Holding) > 7 {
				dd.Time = fmt.Sprintf("%02d:%02d", devCache.Holding[6], devCache.Holding[7])
			}
			od.Devices[dev] = dd
		}
		snap.Omegas = append(snap.Omegas, od)
	}
	return snap
}

func pollAllPlantManagers() {
	configMu.RLock()
	pms := make([]PMCfg, len(config.PlantManagers))
	copy(pms, config.PlantManagers)
	configMu.RUnlock()

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

	clusterDataMu.Lock()
	clusterData = results
	clusterDataMu.Unlock()
	log.Printf("[POLL] %d PlantManager polled", len(results))
}

func startPoller() {
	go func() {
		pollAllPlantManagers()
		for {
			configMu.RLock()
			interval := config.PollInterval
			configMu.RUnlock()
			if interval < 5 {
				interval = 5
			}
			time.Sleep(time.Duration(interval) * time.Second)
			pollAllPlantManagers()
		}
	}()
}

// ---------------------------------------------------------------------------
// HTTP Handlers
// ---------------------------------------------------------------------------

func writeJSONResp(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

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

func clusterHandler(w http.ResponseWriter, r *http.Request) {
	clusterDataMu.RLock()
	defer clusterDataMu.RUnlock()
	writeJSONResp(w, clusterData)
}

func pollHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	go pollAllPlantManagers()
	writeJSONResp(w, map[string]bool{"ok": true})
}

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

// Proxy: set background reader on omega via PlantManager
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
// Main
// ---------------------------------------------------------------------------

func main() {
	exe, err := os.Executable()
	if err != nil {
		configDir, _ = os.Getwd()
	} else {
		configDir = filepath.Dir(exe)
	}

	loadConfig()
	startPoller()

	mux := http.NewServeMux()
	staticDir := filepath.Join(configDir, "static")
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))
	mux.HandleFunc("/api/cluster", clusterHandler)
	mux.HandleFunc("/api/poll", pollHandler)
	mux.HandleFunc("/api/settings", settingsHandler)
	mux.HandleFunc("/api/br-settings", brSettingsHandler)
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

	log.Fatal(http.ListenAndServe(addr, handler))
}
