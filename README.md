# Tekno Tracker Cluster

15 WAGO PFC uzerinden sahadaki tum solar tracker'lari merkezi olarak izleyen ve yoneten sistem.

## Ozellikler

- 15 WAGO'dan paralel veri cekme (PlantManager API uzerinden)
- 3840 tracker'in mod durumunu tek sayfada pixel grid olarak gorme
- Aci haritasi ile tum tracker acilerini izleme
- WAGO/DTK bazinda background reader yonetimi
- Go backend, tek exe, Windows'ta calisir

## Sayfalar

| Sayfa | Aciklama |
|-------|----------|
| Mod Haritasi | 15 WAGO x 16 DTK x 16 tracker = 3840 pixel, mod renkleriyle |
| Aci Haritasi | WAGO bazinda DTK x Cihaz matris, aci degerleri |
| Durum | WAGO listesi — online/offline, DTK sayisi, cihaz sayisi |
| Ayarlar | Poll araligi + WAGO/DTK bazinda background reader ac/kapat |

## Mod Renkleri

| Mod | Kisaltma | Renk |
|-----|----------|------|
| First Test | FT | Gri |
| Astronom | AST | Yesil |
| Night | NGT | Mor |
| Wind | WND | Turuncu |
| Snow | SNW | Mavi |
| Maintenance | MNT | Sari |
| Zero Angle | ZRO | Kahverengi |
| Error | ERR | Kirmizi |
| Offline | OFF | Koyu gri |

## Kurulum

### Gereksinimler
- Go 1.22+ (sadece build icin)
- Windows bilgisayar (sahadaki WAGO'lara erisim)

### Build

```bash
# Windows exe
GOOS=windows GOARCH=amd64 go build -o tekno-tracker-cluster.exe .

# Linux
go build -o tekno-tracker-cluster .
```

### Calistirma

```
tekno-tracker-cluster.exe
```

Browser: http://localhost:8095

### Yapilandirma

Ilk calistirmada `config.json` otomatik olusur:

```json
{
  "port": 8095,
  "poll_interval": 60,
  "wagos": [
    { "name": "WAGO-101", "ip": "192.168.5.101" },
    { "name": "WAGO-102", "ip": "192.168.5.102" },
    ...
    { "name": "WAGO-115", "ip": "192.168.5.115" }
  ]
}
```

## API

| Endpoint | Method | Aciklama |
|----------|--------|----------|
| `/api/cluster` | GET | Tum WAGO + DTK + cihaz verisi |
| `/api/poll` | POST | Sunucu tarafinda manual poll tetikle |
| `/api/settings` | GET/POST | Poll araligi ayari |
| `/api/br-settings` | POST | WAGO/DTK background reader ac/kapat |

## Mimari

```
Windows PC (tekno-tracker-cluster.exe :8095)
    |
    +-- HTTP GET --> WAGO 5.101:8090 (PlantManager)
    |                   +-- /api/omegas (DTK listesi)
    |                   +-- /api/omega/{id}/cache/data (cache verisi)
    |
    +-- HTTP GET --> WAGO 5.102:8090
    |                   ...
    +-- HTTP GET --> WAGO 5.115:8090
```

15 WAGO'ya paralel istek atilir, her WAGO'nun PlantManager'indan omega listesi ve cache verisi cekilir.
