/**
 * Tekno Tracker Cluster — Alpine.js Application
 */

var MODE_COLORS = {
    0: '#9E9E9E',  // First Test
    1: '#4CAF50',  // Astronom
    5: '#673AB7',  // Night
    6: '#FF9800',  // Wind
    7: '#2196F3',  // Snow
    8: '#FFD600',  // Maintenance
    9: '#795548',  // Zero Angle
};
var MODE_NAMES = {
    0: 'First Test', 1: 'Astronom', 5: 'Night', 6: 'Wind',
    7: 'Snow', 8: 'Maintenance', 9: 'Zero Angle',
};
var ERR_COLOR = '#D32F2F';
var OFFLINE_COLOR = '#333';
var NODATA_COLOR = '#1a1a1a';

function modePixelColor(dev) {
    if (!dev || dev.error) return ERR_COLOR;
    if (dev.mode === null || dev.mode === undefined) return NODATA_COLOR;
    return MODE_COLORS[dev.mode] || '#555';
}

function trackerCluster() {
    return {
        currentTab: 'modes',
        cluster: [],
        loading: false,
        lastPoll: '',
        autoRefresh: true,
        _autoTimer: null,

        tabs: [
            { id: 'modes',    label: 'Mod Haritasi' },
            { id: 'angles',   label: 'Aci Haritasi' },
            { id: 'time',     label: 'Zaman Haritasi' },
            { id: 'settings', label: 'Ayarlar' },
        ],

        // Settings
        settings: {
            poll_interval: 60,
            loading: false,
            saving: false,
            msg: '',
        },

        init() {
            this.loadCluster();
            this.loadSettings();
            this.startAutoRefresh();
        },

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

        async manualPoll() {
            await fetch('/api/poll', { method: 'POST' });
            // Wait a bit then reload
            setTimeout(() => this.loadCluster(), 2000);
        },

        startAutoRefresh() {
            if (this._autoTimer) clearInterval(this._autoTimer);
            if (this.autoRefresh) {
                var self = this;
                this._autoTimer = setInterval(function() {
                    self.loadCluster();
                }, (self.settings.poll_interval || 60) * 1000);
            }
        },

        toggleAutoRefresh() {
            if (this.autoRefresh) {
                this.startAutoRefresh();
            } else {
                if (this._autoTimer) clearInterval(this._autoTimer);
                this._autoTimer = null;
            }
        },

        getWagoRows() {
            var rows = [];
            for (var i = 0; i < this.cluster.length; i += 5) {
                rows.push(this.cluster.slice(i, i + 5));
            }
            return rows;
        },

        // Get pixel color for a specific device
        getPixelColor(wago, omegaIdx, devIdx) {
            if (!wago || !wago.online) return OFFLINE_COLOR;
            if (!wago.omegas || omegaIdx >= wago.omegas.length) return NODATA_COLOR;
            var omega = wago.omegas[omegaIdx];
            if (!omega || !omega.online) return OFFLINE_COLOR;
            if (!omega.devices || devIdx >= omega.devices.length) return NODATA_COLOR;
            return modePixelColor(omega.devices[devIdx]);
        },

        // Get angle text
        getAngleText(wago, omegaIdx, devIdx) {
            if (!wago || !wago.online) return '';
            if (!wago.omegas || omegaIdx >= wago.omegas.length) return '';
            var omega = wago.omegas[omegaIdx];
            if (!omega || !omega.online || !omega.devices || devIdx >= omega.devices.length) return '';
            var dev = omega.devices[devIdx];
            if (!dev || dev.error || dev.angle === null || dev.angle === undefined) return '';
            return dev.angle + '';
        },

        getTimeText(wago, omegaIdx, devIdx) {
            if (!wago || !wago.online) return '';
            if (!wago.omegas || omegaIdx >= wago.omegas.length) return '';
            var omega = wago.omegas[omegaIdx];
            if (!omega || !omega.online || !omega.devices || devIdx >= omega.devices.length) return '';
            var dev = omega.devices[devIdx];
            if (!dev || dev.error || !dev.time) return '';
            return dev.time;
        },

        getModeName(val) {
            if (val === null || val === undefined) return '-';
            return MODE_NAMES[val] || ('0x' + val.toString(16).toUpperCase());
        },

        // Total stats
        getStats() {
            var total = 0, online = 0, error = 0, wagosOnline = 0;
            for (var i = 0; i < this.cluster.length; i++) {
                var w = this.cluster[i];
                if (w.online) wagosOnline++;
                if (!w.omegas) continue;
                for (var j = 0; j < w.omegas.length; j++) {
                    var o = w.omegas[j];
                    if (!o.devices) continue;
                    for (var k = 0; k < o.devices.length; k++) {
                        total++;
                        if (o.devices[k].error) error++;
                        else online++;
                    }
                }
            }
            return { total: total, online: online, error: error, wagosOnline: wagosOnline, wagosTotal: this.cluster.length };
        },

        // Settings
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
                    this.startAutoRefresh();
                } else {
                    this.settings.msg = 'Hata';
                }
            } catch (e) {
                this.settings.msg = 'Hata';
            }
            this.settings.saving = false;
        },

        async toggleBR(wagoIp, omegaId, enabled, interval) {
            try {
                await fetch('/api/br-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ wago_ip: wagoIp, omega_id: omegaId, enabled: enabled, interval: interval || 60 }),
                });
            } catch (e) {}
        },
    };
}
