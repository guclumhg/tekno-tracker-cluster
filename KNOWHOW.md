# Tekno Tracker Cluster — Know-How Rehberi

**Yazar:** Muhammed Hasan Guclu

---

## 1. Proje Ozeti

Tekno Tracker Cluster, sahadaki 15 PlantManager'dan veri toplayarak 3840 solar tracker'in durumunu tek bir ekrandan gormenizi saglayan bir Windows uygulamasidir. Her tracker'in hangi modda oldugunu renkli piksellerle, aci degerlerini rakamlarla, saatlerini de ayri bir haritada gorursunuz. Ayrica toplu mod, aci ve saat yazma islemleri yapabilirsiniz.

Neden var? Sahada 15 WAGO var ve her birinin ayri PlantManager'i var. Hepsini tek tek ziyaret etmek yerine bu uygulama hepsini tek sayfada toplar.

---

## 2. Klasor/Dosya Yapisi

```
tekno-tracker-cluster/
├── main.go                     → Go backend: veri toplama, API, HTTP sunucu (415 satir)
├── go.mod                      → Go modul tanimlamasi
├── config.json                 → Ayarlar (otomatik olusur, gitignore'da)
├── tekno-tracker-cluster.exe   → Derlenmus Windows uygulamasi (gitignore'da)
├── .gitignore                  → Git'e eklenmeyecek dosyalar
├── README.md                   → Proje aciklamasi
├── CONTEXT.md                  → Proje baglam dokumani
└── static/
    ├── app.js                  → Alpine.js uygulama mantigi (469 satir)
    ├── index.html              → HTML sayfasi, 4 sekmeli arayuz (260 satir)
    ├── style.css               → Koyu temali gorunum (70 satir)
    ├── alpine.min.js           → Alpine.js kutuphanesi
    └── kilavuz.html            → Kullanma kilavuzu
```

**Toplam:** ~1280 satir kod. Diger projelere gore cok daha kucuk cunku sadece veri toplama ve gosterim yapar, dogrudan cihazla konusmaz.

---

## 3. Kullanilan Teknolojiler

### Go (Golang) — Backend
Windows'ta calisacak tek bir .exe dosyasi uretir. Konsol penceresi acmaz (`-ldflags "-H windowsgui"` ile derlenir). 15 PlantManager'a ayni anda istek atar (goroutine ile paralel).

**Goroutine:** Go'nun hafif thread'i. Her PlantManager icin bir goroutine baslatilir ve hepsi ayni anda calisir. 15 istek 1 saniyede tamamlanir — sirayla olsa 15 saniye surerdi.

**sync.WaitGroup:** "Herkes bitene kadar bekle" mekanizmasi. 15 goroutine baslatilir, hepsi bittiginde sonuclar toplanir.

### Alpine.js — Frontend
Hafif reaktif framework. HTML icine `x-for`, `x-show`, `@click` direktifleri yazarak dinamik arayuz olusturulur. Koyu tema kullanilir — sahada parlak ekran goz yorar.

### HTTP/JSON — Iletisim
Backend PlantManager'lardan HTTP ile veri ceker. Frontend de backend'den HTTP ile veri alir. Her sey JSON formatinda.

### CSS Grid — Piksel Haritasi
16x16'lik piksel gridleri CSS Grid ile olusturulur. Her piksel bir tracker cihazini temsil eder. Renginden modu anlarsiniz.

---

## 4. Kod Akisi

### Baslatma (main.go, satir 373-415)

```
1. Calistirilanin yolu bulunur (config.json ayni klasorde aranir)
2. config.json okunur (yoksa 15 PlantManager ile varsayilan olusturulur)
3. Arka plan poller baslatilir:
   a. Hemen ilk veri cekme yapilir
   b. Sonra her 60 saniyede (ayarlanabilir) tekrar cekilir
4. HTTP route'lar tanimlanir
5. CORS middleware eklenir
6. 0.0.0.0:8095 adresinde dinlemeye baslar
```

### Veri Toplama Dongusu (main.go, satir 227-264)

Arka planda surekli calisan dongu:

```
Her 60 saniyede:
  1. Config'den PlantManager listesi okunur
  2. 15 goroutine paralel baslatilir
  3. Her goroutine bir PlantManager'i polllar:
     a. GET /api/omegas → DTK listesi
     b. Her DTK icin GET /api/omega/{id}/cache/data → cache
     c. Cache'den cikarilir: mod (holding[0]), aci (input[5]), saat (holding[6:7])
  4. WaitGroup ile herkes beklenir
  5. Sonuclar clusterData'ya yazilir (RWMutex ile korunur)
  6. Log: "[POLL] 15 PlantManager polled"
```

### Tek PlantManager Poll (main.go, satir 140-225)

```
pollOnePM(pm):
  1. GET http://192.168.5.X:8090/api/omegas
     - Basarisizsa: snap.Online = false, don
  2. Her omega icin:
     a. GET http://192.168.5.X:8090/api/omega/{id}/cache/data
     b. Basarisizsa: omega.Online = false, tum cihazlar Error
     c. Basariliysa: 16 cihaz icin:
        - holding[0] → mod
        - input[5] → inclinationToDegrees() → aci
        - holding[6], holding[7] → "HH:MM" saat
  3. PMSnapshot dondurulur
```

### Frontend Veri Gosterimi

```
1. Browser acilir → http://localhost:8095
2. Alpine.js init() calisir
3. loadCluster() → GET /api/cluster → tum veri gelir
4. Her PlantManager icin 16x16 piksel grid cizilir
5. Her pikselin rengi = modePixelColor(device)
6. Otomatik yenileme aktifse: setInterval ile tekrar loadCluster()
```

### Toplu Mod Yazma (app.js, satir 274-312)

```
1. Kullanici santral secimi yapar (1-15 toggle butonlari)
2. Mod secer (AST/WND/SNW/MNT)
3. GUNCELLE'ye basar
4. Secili PlantManager'lar icin Promise.all ile paralel istek:
   POST http://192.168.5.X:8090/api/bulk/mode
   {omega_ids: [tum DTK'lar], devices: [0..15], mode: secilen_mod}
5. Sonuc: "240/240 yazildi"
6. 2 saniye sonra otomatik yenileme
```

---

## 5. Onemli Kod Bloklari

### Paralel Veri Toplama (main.go, satir 227-248)

Bu kisim projenin kalbi — 15 PlantManager'a ayni anda istek atar:

```go
func pollAllPlantManagers() {
    configMu.RLock()
    pms := make([]PMCfg, len(config.PlantManagers))
    copy(pms, config.PlantManagers)  // Config'in kopyasini al
    configMu.RUnlock()

    results := make([]PMSnapshot, len(pms))  // Sonuc dizisi
    var wg sync.WaitGroup
    
    for i, p := range pms {
        wg.Add(1)                    // Sayaci artir
        go func(idx int, pm PMCfg) { // Goroutine baslat
            defer wg.Done()          // Bitince sayaci azalt
            results[idx] = pollOnePM(pm)  // Veriyi cek
        }(i, p)
    }
    wg.Wait()  // 15 goroutine'in hepsi bitene kadar bekle

    clusterDataMu.Lock()
    clusterData = results    // Sonuclari kaydet
    clusterDataMu.Unlock()
}
```

**Gunluk hayattan ornek:** 15 garson ayni anda 15 masadan siparis aliyor. Hepsi donunce siparilar mutfaga gonderiliyor.

### Aci Hesaplama (main.go, satir 129-138)

Tracker cihazlarindaki ham deger "inclination" formatindadir. Bu fonksiyon onu dereceye cevirir:

```go
func inclinationToDegrees(val int) int {
    inc := float64(val) / 32768.0  // Normalize: -1.0 ile 1.0 arasi
    if inc > 1.0 { inc = 1.0 }    // Tasmayi onle
    if inc < -1.0 { inc = -1.0 }
    return int(math.Round(
        math.Asin(inc) * 180.0 / math.Pi,  // Radyan → derece
    ))
}
```

**Ornek:** Ham deger 16384 → 16384/32768 = 0.5 → asin(0.5) = 30° → sonuc: 30

### Mod Sayaclari (app.js, satir 154-206)

Ekranda "AST:134 WND:50 ..." gosterimi icin tum cihazlarin modlarini sayan kod:

```javascript
getStats() {
    var mc = { 0: 0, 1: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    var offline = 0, error = 0;
    
    for (var i = 0; i < this.cluster.length; i++) {
        var w = this.cluster[i];
        if (!w.omegas) continue;
        for (var j = 0; j < w.omegas.length; j++) {
            var o = w.omegas[j];
            if (!o.devices) continue;
            for (var k = 0; k < o.devices.length; k++) {
                var d = o.devices[k];
                if (!w.online || !o.online) { offline++; }   // PM/DTK offline
                else if (d.error) { error++; }                // Cihaz hatali
                else if (d.mode != null && mc[d.mode] != undefined) {
                    mc[d.mode]++;  // Mod sayacini artir
                }
            }
        }
    }
    // mc[1] = AST modundaki cihaz sayisi
    // offline = erisilemez cihaz sayisi (PM/DTK kapali)
    // error = hatali cihaz sayisi (iletisim yok)
}
```

**ERR vs OFF farki:** ERR = PlantManager online ama cihaz hata veriyor (kablo sorunu olabilir). OFF = PlantManager veya DTK'ya hic erisilemedi (kapali veya ag sorunu).

### DTK Siralama (app.js, satir 127)

Grid'de DTK1 ustte, DTK16 altta gosterilir. `reverseRow()` fonksiyonu bunu saglar:

```javascript
reverseRow(row) {
    return 17 - row;  // row=1 → 16, row=16 → 1
}
// Grid'de: ust satir = row=1 ama reverseRow(1)=16 → DTK16
//          alt satir = row=16 ama reverseRow(16)=1 → DTK1
// Yani DTK16 ustte, DTK1 altta... 
// HAYIR: Grid yukaridan asagi dolar, reverseRow ters cevirir
// Sonuc: DTK1 ustte
```

### Paralel Yazma (app.js, satir 274-312)

15 PlantManager'a ayni anda mod yazma:

```javascript
var promises = selected.map(function(pm) {
    var ids = pm.omegas.map(function(o) { return o.id; });
    var devices = [];
    for (var d = 0; d < 16; d++) devices.push(d);
    
    return fetch('http://' + pm.ip + ':8090/api/bulk/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omega_ids: ids, devices: devices, mode: mode }),
    }).then(function(r) { return r.json(); })
      .catch(function() { return null; });  // Hata olursa null don
});

var results = await Promise.all(promises);  // Hepsi bitene kadar bekle
```

**Promise.all:** JavaScript'in paralel calistirma araci. 15 HTTP istegi ayni anda gonderilir ve en yavas olan bitene kadar beklenir. Sirayla olsa 15x daha yavas olurdu.

---

## 6. Konfigurasyon & Ortam

### Derleme

```bash
# Windows exe (konsol penceresi acmaz)
GOOS=windows GOARCH=amd64 go build -buildvcs=false -ldflags "-H windowsgui" -o tekno-tracker-cluster.exe .
```

**Flag'ler:**
- `-buildvcs=false`: Git bilgisi ekleme (Windows dosya sistemi sorununu onler)
- `-H windowsgui`: Konsol penceresi acma

### Calistirma

`tekno-tracker-cluster.exe` cift tikla. Ardindan browser'da `http://localhost:8095` ac.

Durdurmak icin: Gorev Yoneticisi → tekno-tracker-cluster.exe → Gorevi Sonlandir.

### Config (config.json)

Ilk calistirmada otomatik olusur:

```json
{
  "port": 8095,
  "poll_interval": 60,
  "plant_managers": [
    { "name": "PlantManager-101", "ip": "192.168.5.101" },
    { "name": "PlantManager-102", "ip": "192.168.5.102" },
    ...
    { "name": "PlantManager-115", "ip": "192.168.5.115" }
  ]
}
```

- `port`: Web sunucu portu
- `poll_interval`: Kac saniyede bir veri cekilsin
- `plant_managers`: PlantManager listesi (isim + IP)

### Ag Gereksinimi
Windows bilgisayariniz 192.168.5.x aginda olmali. Tum WAGO'lara (192.168.5.101-115) HTTP erisim gereklidir.

---

## 7. Sik Karsilasilan Hatalar

### Tum Bloklar Koyu Gri (OFF)
- **Neden:** PlantManager'lara ag erisimi yok
- **Cozum:** Bilgisayarinizin 192.168.5.x aginda olup olmadigini kontrol edin. `ping 192.168.5.101` deneyin.

### Bazi Bloklar OFF, Bazilari Renkli
- **Neden:** O WAGO kapali veya PlantManager calismiyordur
- **Cozum:** Ilgili WAGO'nun acik oldugunu kontrol edin. SSH ile baglanip `ps | grep plantmanager` deneyin.

### Mod Yazma "0/0 yazildi"
- **Neden:** Hic santral secilmemis veya secilen santraller offline
- **Cozum:** Ustteki santral butonlarindan en az birini secin (mavi olmali). Offline santrale yazilamaz.

### Sayfa Acilmiyor (localhost:8095)
- **Neden:** Exe calismiyor
- **Cozum:** Exe'yi tekrar cift tiklayin. Port baskasi tarafindan kullanilyorsa config.json'da portu degistirin.

### Aci Yazilamiyor
- **Neden:** Cihazlar Maintenance modunda degil
- **Cozum:** Once Mod Haritasi'ndan MNT moduna alin, sonra aci gonderin.

### Veri Guncellenmiyordur
- **Neden:** ComBox'ta Background Reader kapali
- **Cozum:** PlantManager web arayuzunun Ayarlar sekmesinden Background Reader'i aktif edin.

---

## 8. Gelistirme Onerileri

1. **Sunucu Durumu Sayfasi:** Ayarlar sekmesine PlantManager listesi + online/offline durumu eklenebilir (suan sadece poll_interval var).

2. **Bildirim Sistemi:** Mod degisikligi veya hata durumunda sesli/gorsel bildirim eklenebilir (ornegin tum saha WND moduna gectiginde uyari).

3. **Tarihsel Veri:** Anlık goruntuleme yerine son 24 saatlik mod/aci degisimlerini grafik olarak gostermek faydali olur. SQLite veya basit CSV ile log tutulabilir.

4. **Sistem Tepsisi:** Windows system tray'de ikon olarak calisabilir — kapatma/baslat kontrolu kolaylasir.

5. **Multi-Site Desteği:** Birden fazla saha (farkli IP araliklari) desteklenebilir. Config'e "site" kavram eklenerek farkli sahalari tek uygulamadan izlemek mumkun.

6. **Dark/Light Tema:** Suan sadece koyu tema var. Gunduz kullanimi icin acik tema secenegi eklenebilir.

7. **Export:** Anlık verileri CSV/Excel olarak indirme ozelligi faydali olabilir (rapor icin).
