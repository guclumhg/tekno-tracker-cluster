# Tekno Tracker Cluster — Proje Context

## Genel Bakis
15 PlantManager uzerinden sahadaki tum solar tracker'lari (3840 adet) merkezi olarak izleyen ve kontrol eden Windows uygulamasi.

## Teknoloji
- **Backend:** Go 1.22, tek exe (windowsgui, konsol penceresi yok)
- **Frontend:** Alpine.js + static HTML/CSS, koyu tema
- **Port:** 8095 (default)
- **Veri kaynagi:** PlantManager API (port 8090), 15 adet

## Saha Yapisi
- 15 PlantManager (192.168.5.101 - 192.168.5.115)
- Her PlantManager'a bagli DTK'lar (16 adet)
- Her DTK'da 1-16 arasi tracker (cihaz)
- Toplam: 15 PM x 16 DTK x 16 tracker = 3840 tracker

## Veri Akisi
1. Go backend 15 PlantManager'a paralel HTTP istegi atar
2. Her PM'den: `/api/omegas` (DTK listesi) + `/api/omega/{id}/cache/data` (cache verisi)
3. Cache'den okunan: holding[0]=mod, input[5]=aci, holding[6:7]=saat
4. Poll araligi: default 60sn, ayarlardan degistirilebilir

## Frontend Sayfalari

### 1. Mod Haritasi
- 15 PM blogu, flex-wrap ile ekrana sigdirilir, ortalanmis
- Her blok 16x16 pixel grid (DTK x Cihaz), 12px pixel
- DTK1 ustte, DTK16 altta (reverseRow)
- Pixel rengi = tracker modu
- Hover ile tooltip (PM adi, DTK no, Cihaz no)
- PM ismine tiklaninca ilgili PlantManager acilir
- Ustte santral secimi (TUMU + 1-15 toggle) + mod secimi (AST/WND/SNW/MNT) + GUNCELLE
- Altta legend: mod bazinda sayaclar (FT:134 AST:200 ... ERR + OFF ayri)
- Paralel yazma (Promise.all)

### 2. Aci Haritasi
- Ayni blok duzeni, 16x16 angle grid (22x14px, 7px font)
- Her hucrede aci degeri (derece, yuvarlanmis)
- Ustte santral secimi + aci girisi (-60~+60) + GUNCELLE
- Paralel yazma

### 3. Zaman Haritasi
- Ayni blok duzeni, 16x16 time grid (28x14px, 7px font, yesil)
- Her hucrede HH:MM formati (holding[6]:holding[7])
- Ustte santral secimi + BROWSER SAATI YAZ + manual tarih/saat + MANUAL YAZ
- Paralel yazma

### 4. Ayarlar
- Cluster poll araligi (sn)

## API Endpointleri

| Endpoint | Method | Aciklama |
|----------|--------|----------|
| `/api/cluster` | GET | Tum PM snapshot verisi (mod, aci, saat) |
| `/api/poll` | POST | Sunucu tarafinda manual poll |
| `/api/settings` | GET/POST | Poll araligi config |
| `/api/br-settings` | POST | Background reader toggle (PM proxy) |

## Config (config.json)
```json
{
  "port": 8095,
  "poll_interval": 60,
  "plant_managers": [
    { "name": "PlantManager-101", "ip": "192.168.5.101" },
    ...
    { "name": "PlantManager-115", "ip": "192.168.5.115" }
  ]
}
```

## Mod Renkleri
| Kod | Mod | Kisaltma | Renk |
|-----|-----|----------|------|
| 0x00 | First Test | FT | #9E9E9E |
| 0x01 | Astronom | AST | #4CAF50 |
| 0x05 | Night | NGT | #673AB7 |
| 0x06 | Wind | WND | #FF9800 |
| 0x07 | Snow | SNW | #2196F3 |
| 0x08 | Maintenance | MNT | #FFD600 |
| 0x09 | Zero Angle | ZRO | #795548 |
| -1 | Error | ERR | #D32F2F |
| - | Offline | OFF | #333333 |

## Build
```bash
GOOS=windows GOARCH=amd64 go build -buildvcs=false -ldflags "-H windowsgui" -o tekno-tracker-cluster.exe .
```

## Calistirma
`tekno-tracker-cluster.exe` cift tikla. Konsol penceresi acilmaz.
Browser: http://localhost:8095
Durdurmak icin: Gorev Yoneticisi > tekno-tracker-cluster.exe > Gorevi Sonlandir

## Bagimliliklar
- PlantManager her WAGO'da calisiyor olmali (port 8090)
- ComBox background reader aktif olmali (cache verisi icin)
- Windows PC'den PlantManager'lara network erisim olmali (192.168.5.x)
