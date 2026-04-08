# Tekno Tracker Cluster

15 PlantManager uzerinden sahadaki tum solar tracker'lari merkezi olarak izleyen ve kontrol eden sistem.

## Ozellikler

- 15 PlantManager'dan paralel veri cekme
- 3840 tracker'in mod durumunu tek sayfada pixel grid olarak gorme
- Aci ve zaman haritasi ile tum tracker'lari izleme
- Toplu mod, aci ve zaman yazma (santral secimli, paralel)
- Go backend, tek exe, Windows'ta calisir (konsol penceresi yok)

## Sayfalar

| Sayfa | Aciklama |
|-------|----------|
| Mod Haritasi | 15 PM x 16 DTK x 16 tracker = 3840 pixel, mod renkleriyle. Toplu mod guncelleme (AST/WND/SNW/MNT) |
| Aci Haritasi | Ayni duzende aci degerleri. Toplu aci guncelleme (-60~+60) |
| Zaman Haritasi | Ayni duzende HH:MM saat bilgisi. Browser saati veya manual saat yazma |
| Ayarlar | Poll araligi ayari |

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
- Windows bilgisayar (sahadaki PlantManager'lara erisim)

### Build

```bash
GOOS=windows GOARCH=amd64 go build -buildvcs=false -ldflags "-H windowsgui" -o tekno-tracker-cluster.exe .
```

### Calistirma

`tekno-tracker-cluster.exe` cift tikla. Konsol penceresi acilmaz.

Browser: http://localhost:8095

Durdurmak icin: Gorev Yoneticisi > tekno-tracker-cluster.exe > Gorevi Sonlandir

### Yapilandirma

Ilk calistirmada `config.json` otomatik olusur:

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

## API

| Endpoint | Method | Aciklama |
|----------|--------|----------|
| `/api/cluster` | GET | Tum PM + DTK + cihaz verisi |
| `/api/poll` | POST | Manual poll tetikle |
| `/api/settings` | GET/POST | Poll araligi ayari |
| `/api/br-settings` | POST | Background reader toggle (PM proxy) |

## Mimari

```
Windows PC (tekno-tracker-cluster.exe :8095)
    |
    +-- paralel HTTP --> PlantManager-101 :8090
    |                       +-- /api/omegas
    |                       +-- /api/omega/{id}/cache/data
    |
    +-- paralel HTTP --> PlantManager-102 :8090
    |                       ...
    +-- paralel HTTP --> PlantManager-115 :8090
```

15 PlantManager'a paralel istek atilir, her birinden DTK listesi ve cache verisi cekilir.
Yazma islemleri de paralel (Promise.all) gonderilir.
