/**
 * Tekno Tracker Cluster — Alpine.js Application
 * 4 sekmeli tek sayfa uygulama: Mod Haritasi, Aci Haritasi,
 * Zaman Haritasi, Ayarlar. Koyu temali, pixel grid gorunum.
 *
 * Designed and Written by Muhammed Hasan GUCLU - 2026
 */

// ---------------------------------------------------------------------------
// Sabitler — Mod renkleri, mod isimleri ve ozel durum renkleri
// ---------------------------------------------------------------------------

// MODE_COLORS: Her tracker modunun pixel grid'deki rengi.
// Mod numaralari Modbus holding register'dan gelir.
var MODE_COLORS = {
    0: '#9E9E9E',  // First Test
    1: '#4CAF50',  // Astronom
    5: '#673AB7',  // Night
    6: '#FF9800',  // Wind
    7: '#2196F3',  // Snow
    8: '#FFD600',  // Maintenance
    9: '#795548',  // Zero Angle
};

// MODE_NAMES: Mod numarasinin okunabilir isim karsiligi
var MODE_NAMES = {
    0: 'First Test', 1: 'Astronom', 5: 'Night', 6: 'Wind',
    7: 'Snow', 8: 'Maintenance', 9: 'Zero Angle',
};

// Ozel durum renkleri
var ERR_COLOR = '#D32F2F';     // Hata olan cihazlar icin kirmizi
var OFFLINE_COLOR = '#333';     // Cevrimdisi PM/Omega icin koyu gri
var NODATA_COLOR = '#1a1a1a';   // Veri gelmemis cihazlar icin arka plan rengi

// modePixelColor: Bir cihazin mod degerine gore pixel rengini dondurur.
// Hata varsa kirmizi, mod bilinmiyorsa gri tonlari kullanilir.
function modePixelColor(dev) {
    if (!dev || dev.error) return ERR_COLOR;
    if (dev.mode === null || dev.mode === undefined) return NODATA_COLOR;
    return MODE_COLORS[dev.mode] || '#555';
}

// ---------------------------------------------------------------------------
// Alpine.js Ana Bileseni — trackerCluster()
// Tum uygulama durumunu ve islevlerini icerir.
// ---------------------------------------------------------------------------
function trackerCluster() {
    return {
        // Aktif sekme: modes / angles / time / settings
        currentTab: 'modes',
        // Tum PM verileri — /api/cluster'dan gelen dizi
        cluster: [],
        // Veri yukleniyor mu gostergesi
        loading: false,
        // Son veri cekilme zamani (goruntulenecek)
        lastPoll: '',
        // Otomatik yenileme acik/kapali
        autoRefresh: true,
        // Otomatik yenileme timer referansi
        _autoTimer: null,

        // Sekme tanimlari — her birinin id ve goruntu ismi var
        tabs: [
            { id: 'modes',    label: 'Mod Haritasi' },
            { id: 'angles',   label: 'Aci Haritasi' },
            { id: 'time',     label: 'Zaman Haritasi' },
            { id: 'settings', label: 'Ayarlar' },
        ],

        // Toplu mod yazma durumu — hangi PM'ler secili, hangi mod, islem durumu
        bulk: {
            selectedPMs: {},
            selectedMode: null,
            busy: false,
            msg: '',
        },
        // Toplu aci yazma durumu
        bulkAngle: {
            selectedPMs: {},
            angle: '',
            busy: false,
            msg: '',
        },
        // Toplu zaman yazma durumu
        bulkTime: {
            selectedPMs: {},
            manualDate: '',
            manualTime: '',
            busy: false,
            msg: '',
        },
        // Toplu mod secenekleri — kullanicinin secebilecegi mod butonlari
        bulkModes: [
            { value: 0x01, label: 'AST', color: '#4CAF50' },
            { value: 0x06, label: 'WND', color: '#FF9800' },
            { value: 0x07, label: 'SNW', color: '#2196F3' },
            { value: 0x08, label: 'MNT', color: '#FFD600' },
        ],

        // Ayarlar sekmesi durumu
        settings: {
            poll_interval: 60,
            loading: false,
            saving: false,
            msg: '',
        },

        // init: Alpine.js bileseni baslatildiginda cagirilir.
        // Cluster verisini ve ayarlari yukler, otomatik yenilemeyi baslatir.
        init() {
            this.loadCluster();
            this.loadSettings();
            this.startAutoRefresh();
        },

        // loadCluster: Backend'den /api/cluster ile tum PM verilerini ceker.
        // Basarili olursa cluster dizisini gunceller ve son poll zamanini kaydeder.
        async loadCluster() {
            this.loading = true;
            try {
                var resp = await fetch('/api/cluster');
                var data = await resp.json();
                if (Array.isArray(data)) {
                    this.cluster = data;
                    this.lastPoll = new Date().toLocaleTimeString();
                }
            } catch (e) {
                console.error('Cluster fetch error:', e);
            }
            this.loading = false;
        },

        // manualPoll: Kullanici "Yenile" butonuna bastiginda cagirilir.
        // Backend'e poll istegi gonderir, 2sn bekleyip veriyi tekrar ceker.
        // Bekleme sebebi: backend'in tum PM'leri sorgulamasi zaman alir.
        async manualPoll() {
            await fetch('/api/poll', { method: 'POST' });
            setTimeout(() => this.loadCluster(), 2000);
        },

        // startAutoRefresh: Periyodik otomatik yenileme timer'ini baslatir.
        // poll_interval ayarina gore saniye cinsinden tekrar eder.
        startAutoRefresh() {
            if (this._autoTimer) clearInterval(this._autoTimer);
            if (this.autoRefresh) {
                var self = this;
                this._autoTimer = setInterval(function() {
                    self.loadCluster();
                }, (self.settings.poll_interval || 60) * 1000);
            }
        },

        // toggleAutoRefresh: Otomatik yenileme toggle edildiginde cagirilir.
        // Aciksa timer baslatir, kapaliysa timer'i durdurur.
        toggleAutoRefresh() {
            if (this.autoRefresh) {
                this.startAutoRefresh();
            } else {
                if (this._autoTimer) clearInterval(this._autoTimer);
                this._autoTimer = null;
            }
        },

        // getPMRows: PM'leri satir bazli dizi olarak dondurur (grid gosterimi icin)
        getPMRows() {
            return [this.cluster];
        },

        // pmOmegaCount: PM'deki omega sayisini dondurur.
        pmOmegaCount(pm) {
            return (pm && pm.omegas) ? pm.omegas.length : 16;
        },

        // pmMaxDevices: PM'deki en buyuk device_count degerini dondurur.
        pmMaxDevices(pm) {
            if (!pm || !pm.omegas || pm.omegas.length === 0) return 16;
            var max = 0;
            for (var i = 0; i < pm.omegas.length; i++) {
                var dc = pm.omegas[i].device_count || 16;
                if (dc > max) max = dc;
            }
            return max || 16;
        },

        // reverseRow: Omega satir numarasini ters cevirir.
        // Fiziksel yerlesimde Omega siralama yukari-asagi oldugu icin gerekli.
        reverseRow(row, pm) {
            var count = this.pmOmegaCount(pm);
            return (count + 1) - row;
        },

        // -----------------------------------------------------------------------
        // Pixel Renk ve Veri Erisim Fonksiyonlari
        // -----------------------------------------------------------------------

        // getTooltip: Pixel/hucre icin tooltip metni olusturur.
        getTooltip(pm, omegaIdx, col) {
            var base = pm.name + ' DTK' + (omegaIdx + 1) + ' Cihaz' + col;
            if (!pm || !pm.omegas || omegaIdx >= pm.omegas.length) return base;
            var omega = pm.omegas[omegaIdx];
            if (!omega) return base;
            // Mod, aci ve saat bilgisi ekle
            if (omega.online && omega.devices && (col - 1) < omega.devices.length) {
                var dev = omega.devices[col - 1];
                if (dev && !dev.error) {
                    var modeName = (dev.mode !== null && dev.mode !== undefined) ? (MODE_NAMES[dev.mode] || ('Mod ' + dev.mode)) : '?';
                    var angleStr = (dev.angle !== null && dev.angle !== undefined) ? dev.angle + '°' : '?';
                    var timeStr = dev.time || '?';
                    base += ' | ' + modeName + ' | ' + angleStr + ' | Saat: ' + timeStr;
                } else {
                    base += ' | Hata';
                }
            }
            // Cache fallback bilgisi
            if (omega.cached && omega.cache_age !== undefined) {
                var age = omega.cache_age;
                var ageStr = age < 60 ? age + 'sn' : Math.floor(age / 60) + 'dk';
                base += ' | (cached veri, ' + ageStr + ' once)';
            }
            return base;
        },

        // getPixelColor: Belirli bir PM > Omega > Cihaz icin mod rengini dondurur.
        // PM offline, Omega offline veya veri yoksa uygun durum rengini verir.
        getPixelColor(pm, omegaIdx, devIdx) {
            if (!pm || !pm.online) return OFFLINE_COLOR;
            if (!pm.omegas || omegaIdx >= pm.omegas.length) return NODATA_COLOR;
            var omega = pm.omegas[omegaIdx];
            if (!omega || !omega.online) return OFFLINE_COLOR;
            if (!omega.devices || devIdx >= omega.devices.length) return NODATA_COLOR;
            return modePixelColor(omega.devices[devIdx]);
        },

        // getAngleText: Belirli bir cihazin aci degerini metin olarak dondurur.
        // Hata veya veri yoksa bos string doner.
        getAngleText(pm, omegaIdx, devIdx) {
            if (!pm || !pm.online) return '';
            if (!pm.omegas || omegaIdx >= pm.omegas.length) return '';
            var omega = pm.omegas[omegaIdx];
            if (!omega || !omega.online || !omega.devices || devIdx >= omega.devices.length) return '';
            var dev = omega.devices[devIdx];
            if (!dev || dev.error || dev.angle === null || dev.angle === undefined) return '';
            return dev.angle + '';
        },

        // getTimeText: Belirli bir cihazin saat bilgisini metin olarak dondurur.
        getTimeText(pm, omegaIdx, devIdx) {
            if (!pm || !pm.online) return '';
            if (!pm.omegas || omegaIdx >= pm.omegas.length) return '';
            var omega = pm.omegas[omegaIdx];
            if (!omega || !omega.online || !omega.devices || devIdx >= omega.devices.length) return '';
            var dev = omega.devices[devIdx];
            if (!dev || dev.error || !dev.time) return '';
            return dev.time;
        },

        // getModeName: Mod numarasini okunabilir isme cevirir.
        // Tanimli degilse hex gosterim kullanir (orn: 0x0A).
        getModeName(val) {
            if (val === null || val === undefined) return '-';
            return MODE_NAMES[val] || ('0x' + val.toString(16).toUpperCase());
        },

        // -----------------------------------------------------------------------
        // Istatistik Hesaplama
        // -----------------------------------------------------------------------

        // getStats: Tum cluster icin ozet istatistikleri hesaplar.
        // Toplam cihaz, online, offline, hatali sayilari ve mod bazli dagilimi dondurur.
        getStats() {
            var total = 0, online = 0, error = 0, offline = 0, pmsOnline = 0;
            // Mod bazli sayac — her mod icin kac cihaz o modda
            var mc = { 0: 0, 1: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

            // Tum PM > Omega > Cihaz hiyerarsisini tara
            for (var i = 0; i < this.cluster.length; i++) {
                var w = this.cluster[i];
                if (w.online) pmsOnline++;
                if (!w.omegas) continue;
                for (var j = 0; j < w.omegas.length; j++) {
                    var o = w.omegas[j];
                    if (!o.devices) continue;
                    for (var k = 0; k < o.devices.length; k++) {
                        total++;
                        var d = o.devices[k];
                        if (!w.online || !o.online) { offline++; }
                        else if (d.error) { error++; }
                        else {
                            online++;
                            if (d.mode !== null && d.mode !== undefined && mc[d.mode] !== undefined) mc[d.mode]++;
                        }
                    }
                }
            }

            // Legend icin mod dagilimi dizisi — UI'da renk kutucuklariyla gosterilir
            var modeCounts = [
                { label: 'FT', count: mc[0], color: '#9E9E9E' },
                { label: 'AST', count: mc[1], color: '#4CAF50' },
                { label: 'NGT', count: mc[5], color: '#673AB7' },
                { label: 'WND', count: mc[6], color: '#FF9800' },
                { label: 'SNW', count: mc[7], color: '#2196F3' },
                { label: 'MNT', count: mc[8], color: '#FFD600' },
                { label: 'ZRO', count: mc[9], color: '#795548' },
                { label: 'ERR', count: error, color: '#D32F2F' },
                { label: 'OFF', count: offline, color: '#555' },
            ];
            return { total: total, online: online, error: error, offline: offline, pmsOnline: pmsOnline, pmsTotal: this.cluster.length, modeCounts: modeCounts };
        },

        // -----------------------------------------------------------------------
        // Ayarlar Yonetimi
        // -----------------------------------------------------------------------

        // loadSettings: Backend'den mevcut ayarlari ceker.
        async loadSettings() {
            this.settings.loading = true;
            try {
                var resp = await fetch('/api/settings');
                var data = await resp.json();
                if (data) {
                    this.settings.poll_interval = data.poll_interval || 60;
                }
            } catch (e) {}
            this.settings.loading = false;
        },

        // saveSettings: Degistirilen ayarlari backend'e kaydeder.
        // Basarili olursa otomatik yenileme timer'ini yeni aralikla yeniden baslatir.
        async saveSettings() {
            this.settings.saving = true;
            this.settings.msg = '';
            try {
                var resp = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ poll_interval: this.settings.poll_interval }),
                });
                var data = await resp.json();
                if (data && data.ok) {
                    this.settings.msg = 'Kaydedildi';
                    // Yeni poll araligi ile timer'i yeniden baslat
                    this.startAutoRefresh();
                } else {
                    this.settings.msg = 'Hata';
                }
            } catch (e) {
                this.settings.msg = 'Hata';
            }
            this.settings.saving = false;
        },

        // -----------------------------------------------------------------------
        // Toplu Mod Yazma (Bulk Mode)
        // Secili PM'lerdeki tum Omega ve cihazlara ayni modu yazar.
        // -----------------------------------------------------------------------

        // bulkTogglePM: Belirli bir PM'in secim durumunu degistirir
        bulkTogglePM(idx) {
            this.bulk.selectedPMs = Object.assign({}, this.bulk.selectedPMs,
                { [idx]: !this.bulk.selectedPMs[idx] });
        },

        // bulkSelectAll: Tumu sec / tumu kaldir toggle islemi
        bulkSelectAll() {
            var all = {};
            var allSelected = true;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulk.selectedPMs[i]) allSelected = false;
                all[i] = true;
            }
            // Hepsi zaten seciliyse kaldir, degilse hepsini sec
            if (allSelected) {
                this.bulk.selectedPMs = {};
            } else {
                this.bulk.selectedPMs = all;
            }
        },

        // bulkAllSelected: Tum PM'ler secili mi kontrolu
        bulkAllSelected() {
            if (this.cluster.length === 0) return false;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulk.selectedPMs[i]) return false;
            }
            return true;
        },

        // bulkSelectMode: Mod butonuna tiklandiginda secim yapar.
        // Ayni moda tekrar tiklanirsa secimi kaldirir (toggle).
        bulkSelectMode(val) {
            this.bulk.selectedMode = (this.bulk.selectedMode === val) ? null : val;
        },

        // bulkApplyMode: Secili PM'lerin tum Omega/cihazlarina secilen modu yazar.
        // Her PM'e paralel istek gonderir, sonuclari toplar ve kullaniciya bildirir.
        async bulkApplyMode() {
            if (this.bulk.selectedMode === null) return;
            // Sadece secili ve online olan PM'leri filtrele
            var selected = [];
            for (var i = 0; i < this.cluster.length; i++) {
                if (this.bulk.selectedPMs[i] && this.cluster[i].online) selected.push(this.cluster[i]);
            }
            if (selected.length === 0) return;

            this.bulk.busy = true;
            this.bulk.msg = 'Yaziliyor... (' + selected.length + ' santral)';
            var mode = this.bulk.selectedMode;

            // Her PM icin kendi bulk/mode endpoint'ine paralel istek gonder
            var promises = selected.map(function(pm) {
                if (!pm.omegas) return Promise.resolve(null);
                var ids = pm.omegas.map(function(o) { return o.id; });
                // PM'den gelen device_count kadar cihaza yazma yapilir
                var maxDev = Math.max.apply(null, pm.omegas.map(function(o) { return o.device_count || 16; }));
                var devices = [];
                for (var d = 0; d < maxDev; d++) devices.push(d);
                return fetch('http://' + pm.ip + ':8090/api/bulk/mode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ omega_ids: ids, devices: devices, mode: mode }),
                }).then(function(r) { return r.json(); }).catch(function() { return null; });
            });

            // Tum paralel isteklerin tamamlanmasini bekle
            var results = await Promise.all(promises);
            // Basarili/toplam yazma sayisini hesapla
            var totalOk = 0, totalAll = 0;
            for (var i = 0; i < results.length; i++) {
                if (results[i] && results[i].results) {
                    for (var j = 0; j < results[i].results.length; j++) {
                        totalAll++;
                        if (results[i].results[j].success) totalOk++;
                    }
                }
            }

            this.bulk.busy = false;
            this.bulk.msg = totalOk + '/' + totalAll + ' yazildi';
            // 2sn sonra veriyi yenileyerek degisiklikleri goruntule
            setTimeout(() => this.loadCluster(), 2000);
        },

        // -----------------------------------------------------------------------
        // Toplu Aci Yazma (Bulk Angle)
        // Secili PM'lerdeki tum cihazlara ayni aciyi yazar.
        // -----------------------------------------------------------------------

        // bulkAngleTogglePM: Aci sekmesinde PM secim toggle
        bulkAngleTogglePM(idx) {
            this.bulkAngle.selectedPMs = Object.assign({}, this.bulkAngle.selectedPMs,
                { [idx]: !this.bulkAngle.selectedPMs[idx] });
        },

        // bulkAngleSelectAll: Aci sekmesinde tumu sec/kaldir
        bulkAngleSelectAll() {
            var all = {};
            var allSelected = true;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulkAngle.selectedPMs[i]) allSelected = false;
                all[i] = true;
            }
            this.bulkAngle.selectedPMs = allSelected ? {} : all;
        },

        // bulkAngleAllSelected: Tum PM'ler secili mi kontrolu
        bulkAngleAllSelected() {
            if (this.cluster.length === 0) return false;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulkAngle.selectedPMs[i]) return false;
            }
            return true;
        },

        // bulkApplyAngle: Secili PM'lere girilen aciyi toplu yazar.
        // Aci -60 ile +60 derece arasinda olmali (tracker fiziksel siniri).
        async bulkApplyAngle() {
            var angle = parseFloat(this.bulkAngle.angle);
            // Gecersiz veya sinir disindaki acilari reddet
            if (isNaN(angle) || angle < -60 || angle > 60) return;
            var selected = [];
            for (var i = 0; i < this.cluster.length; i++) {
                if (this.bulkAngle.selectedPMs[i] && this.cluster[i].online) selected.push(this.cluster[i]);
            }
            if (selected.length === 0) return;

            this.bulkAngle.busy = true;
            this.bulkAngle.msg = 'Yaziliyor... (' + selected.length + ' santral)';

            // Her PM'e paralel aci yazma istegi gonder
            var promises = selected.map(function(pm) {
                if (!pm.omegas) return Promise.resolve(null);
                var ids = pm.omegas.map(function(o) { return o.id; });
                var maxDev = Math.max.apply(null, pm.omegas.map(function(o) { return o.device_count || 16; }));
                var devices = [];
                for (var d = 0; d < maxDev; d++) devices.push(d);
                return fetch('http://' + pm.ip + ':8090/api/bulk/angle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ omega_ids: ids, devices: devices, angle: angle }),
                }).then(function(r) { return r.json(); }).catch(function() { return null; });
            });

            var results = await Promise.all(promises);
            var totalOk = 0, totalAll = 0;
            for (var i = 0; i < results.length; i++) {
                if (results[i] && results[i].results) {
                    for (var j = 0; j < results[i].results.length; j++) {
                        totalAll++;
                        if (results[i].results[j].success) totalOk++;
                    }
                }
            }

            this.bulkAngle.busy = false;
            this.bulkAngle.msg = totalOk + '/' + totalAll + ' yazildi';
            setTimeout(() => this.loadCluster(), 2000);
        },

        // -----------------------------------------------------------------------
        // Toplu Zaman Yazma (Bulk Time)
        // Secili PM'lerdeki tum Omega'lara saat/tarih yazar.
        // Tarayici saati veya manuel giris kullanilabilir.
        // -----------------------------------------------------------------------

        // bulkTimeTogglePM: Zaman sekmesinde PM secim toggle
        bulkTimeTogglePM(idx) {
            this.bulkTime.selectedPMs = Object.assign({}, this.bulkTime.selectedPMs,
                { [idx]: !this.bulkTime.selectedPMs[idx] });
        },

        // bulkTimeSelectAll: Zaman sekmesinde tumu sec/kaldir
        bulkTimeSelectAll() {
            var all = {};
            var allSelected = true;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulkTime.selectedPMs[i]) allSelected = false;
                all[i] = true;
            }
            this.bulkTime.selectedPMs = allSelected ? {} : all;
        },

        // bulkTimeAllSelected: Tum PM'ler secili mi kontrolu
        bulkTimeAllSelected() {
            if (this.cluster.length === 0) return false;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulkTime.selectedPMs[i]) return false;
            }
            return true;
        },

        // bulkApplyTimeBrowser: Tarayicinin anlik saatini tum secili PM'lere yazar.
        // Sahada bilgisayar saati referans alinarak tracker'lar senkronize edilir.
        async bulkApplyTimeBrowser() {
            var now = new Date();
            await this._bulkApplyTime(now.getFullYear(), now.getMonth() + 1, now.getDate(),
                now.getHours(), now.getMinutes(), now.getSeconds());
        },

        // bulkApplyTimeManual: Kullanicinin elle girdigi tarih/saat degerini yazar.
        // Farkli saat dilimi veya ozel zaman ayari gerektigi durumlarda kullanilir.
        async bulkApplyTimeManual() {
            if (!this.bulkTime.manualDate || !this.bulkTime.manualTime) return;
            var dp = this.bulkTime.manualDate.split('-');
            var tp = this.bulkTime.manualTime.split(':');
            await this._bulkApplyTime(parseInt(dp[0]), parseInt(dp[1]), parseInt(dp[2]),
                parseInt(tp[0]), parseInt(tp[1]), parseInt(tp[2] || 0));
        },

        // _bulkApplyTime: Ortak zaman yazma fonksiyonu.
        // Yil, ay, gun, saat, dakika, saniye parametrelerini alir ve
        // secili tum PM'lerin Omega'larina paralel olarak yazar.
        async _bulkApplyTime(year, month, day, hour, minute, second) {
            var selected = [];
            for (var i = 0; i < this.cluster.length; i++) {
                if (this.bulkTime.selectedPMs[i] && this.cluster[i].online) selected.push(this.cluster[i]);
            }
            if (selected.length === 0) return;

            this.bulkTime.busy = true;
            this.bulkTime.msg = 'Yaziliyor... (' + selected.length + ' santral)';

            // Her PM'e paralel zaman yazma istegi
            var promises = selected.map(function(pm) {
                if (!pm.omegas) return Promise.resolve(null);
                var ids = pm.omegas.map(function(o) { return o.id; });
                return fetch('http://' + pm.ip + ':8090/api/bulk/time', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ omega_ids: ids, year: year, month: month, day: day, hour: hour, minute: minute, second: second }),
                }).then(function(r) { return r.json(); }).catch(function() { return null; });
            });

            var results = await Promise.all(promises);
            var totalOk = 0, totalAll = 0;
            for (var i = 0; i < results.length; i++) {
                if (results[i] && results[i].results) {
                    for (var j = 0; j < results[i].results.length; j++) {
                        totalAll++;
                        if (results[i].results[j].success) totalOk++;
                    }
                }
            }

            this.bulkTime.busy = false;
            this.bulkTime.msg = totalOk + '/' + totalAll + ' yazildi';
            setTimeout(() => this.loadCluster(), 2000);
        },

        // bulkTimeBrowserNow: Tarayicinin anlik saatini formatli metin olarak dondurur.
        // "Tarayici Saati" butonunun yaninda gosterilir (ornek: 2026-04-07 14:30:25).
        bulkTimeBrowserNow() {
            var now = new Date();
            return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0') + ' ' +
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0') + ':' +
                String(now.getSeconds()).padStart(2, '0');
        },

        // -----------------------------------------------------------------------
        // Background Reader Kontrolu
        // -----------------------------------------------------------------------

        // toggleBR: Omega'nin arka plan okuyucusunu ac/kapat.
        // Bu ayar, Omega'nin belirli araliklarla otomatik Modbus okuma yapmasini saglar.
        // Backend'e proxy istegi gonderir, backend de PM'e iletir.
        async toggleBR(pmIp, omegaId, enabled, interval) {
            try {
                await fetch('/api/br-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pm_ip: pmIp, omega_id: omegaId, enabled: enabled, interval: interval || 60 }),
                });
            } catch (e) {}
        },
    };
}
