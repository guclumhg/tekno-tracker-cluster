# Versiyon Kurali

Her commit'te versiyon numarasini guncelle. Versiyon = toplam commit sayisi / 10.
Ornek: 43 commit → v4.3, 50 commit → v5.0

Guncellenmesi gereken dosya:
- `static/app.js` → `var APP_VERSION = "X.Y";`

Commit sayisini ogren: `git rev-list --count HEAD` (commit ONCESI), sonra +1 ekle.
