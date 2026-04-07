# Tekno Tracker Cluster — Proje Context

## Genel Bakis
15 WAGO PFC uzerinden sahadaki tum solar tracker'lari (3840 adet) merkezi olarak izleyen ve yoneten Windows uygulamasi.

## Teknoloji
- **Backend:** Go 1.22, tek exe, Windows'ta calisir
- **Frontend:** Alpine.js + static HTML/CSS, koyu tema
- **Port:** 8095 (default)
- **Veri kaynagi:** WAGO PlantManager API (port 8090)

## Saha Yapisi
- 15 WAGO PFC (192.168.5.101 - 192.168.5.115)
- Her WAGO'da PlantManager calisiyor (port 8090)
- Her WAGO'ya bagli DTK'lar (Omega/ComBox cihazlari)
- Her DTK'da 1-16 arasi tracker (cihaz)
- Toplam: 15 WAGO x ~16 DTK x ~16 tracker = ~3840 tracker

## Veri Akisi
1. Go backend 15 WAGO'ya paralel HTTP istegi atar
2. Her WAGO'dan: `/api/omegas` (DTK listesi) + `/api/omega/{id}/cache/data` (cache verisi)
3. Cache verisi RAM'de tutulur, frontend'e `/api/cluster` ile sunulur
4. Poll araligi: default 60sn, ayarlardan degistirilebilir

## Frontend Sayfalari

### 1. Mod Haritasi
- 15 WAGO blogu: sol 8, sag 7
- Her blok 16x16 pixel grid (DTK x Cihaz)
- Pixel rengi = tracker modu
- Hover ile tooltip (WAGO, DTK, Cihaz bilgisi)

### 2. Aci Haritasi
- WAGO bazinda tablo
- Satir: DTK, Sutun: 1-16 cihaz
- Hucre: guncel aci (derece, yuvarlanmis)

### 3. Durum
- WAGO listesi: isim, IP, online/offline, DTK sayisi, cihaz sayisi, son guncelleme

### 4. Ayarlar
- Cluster poll araligi (sn)
- WAGO/DTK bazinda background reader ac/kapat

## API Endpointleri

| Endpoint | Method | Aciklama |
|----------|--------|----------|
| `/api/cluster` | GET | Tum WAGO snapshot verisi |
| `/api/poll` | POST | Sunucu tarafinda manual poll |
| `/api/settings` | GET/POST | Poll araligi config |
| `/api/br-settings` | POST | Background reader toggle (PlantManager proxy) |

## Config (config.json)
```json
{
  "port": 8095,
  "poll_interval": 60,
  "wagos": [
    { "name": "WAGO-101", "ip": "192.168.5.101" },
    ...
    { "name": "WAGO-115", "ip": "192.168.5.115" }
  ]
}
```

## Mod Renkleri
| Kod | Mod | Renk | Hex |
|-----|-----|------|-----|
| 0x00 | First Test | Gri | #9E9E9E |
| 0x01 | Astronom | Yesil | #4CAF50 |
| 0x05 | Night | Mor | #673AB7 |
| 0x06 | Wind | Turuncu | #FF9800 |
| 0x07 | Snow | Mavi | #2196F3 |
| 0x08 | Maintenance | Sari | #FFD600 |
| 0x09 | Zero Angle | Kahverengi | #795548 |
| -1 | Error | Kirmizi | #D32F2F |
| - | Offline | Koyu gri | #333333 |

## Build
```bash
# Windows
GOOS=windows GOARCH=amd64 go build -o tekno-tracker-cluster.exe .

# Linux
go build -o tekno-tracker-cluster .
```

## Bagimliliklar
- PlantManager her WAGO'da calisiyor olmali (port 8090)
- ComBox background reader aktif olmali (cache verisi icin)
- Windows PC'den WAGO'lara network erisim olmali (192.168.5.x)
