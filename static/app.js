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

        // Bulk mode control
        bulk: {
            selectedPMs: {},
            selectedMode: null,
            busy: false,
            msg: '',
        },
        // Bulk angle control
        bulkAngle: {
            selectedPMs: {},
            angle: '',
            busy: false,
            msg: '',
        },
        bulkModes: [
            { value: 0x01, label: 'AST', color: '#4CAF50' },
            { value: 0x06, label: 'WND', color: '#FF9800' },
            { value: 0x07, label: 'SNW', color: '#2196F3' },
            { value: 0x08, label: 'MNT', color: '#FFD600' },
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

        getPMRows() {
            return [this.cluster];
        },

        // Get pixel color for a specific device
        getPixelColor(pm, omegaIdx, devIdx) {
            if (!pm || !pm.online) return OFFLINE_COLOR;
            if (!pm.omegas || omegaIdx >= pm.omegas.length) return NODATA_COLOR;
            var omega = pm.omegas[omegaIdx];
            if (!omega || !omega.online) return OFFLINE_COLOR;
            if (!omega.devices || devIdx >= omega.devices.length) return NODATA_COLOR;
            return modePixelColor(omega.devices[devIdx]);
        },

        // Get angle text
        getAngleText(pm, omegaIdx, devIdx) {
            if (!pm || !pm.online) return '';
            if (!pm.omegas || omegaIdx >= pm.omegas.length) return '';
            var omega = pm.omegas[omegaIdx];
            if (!omega || !omega.online || !omega.devices || devIdx >= omega.devices.length) return '';
            var dev = omega.devices[devIdx];
            if (!dev || dev.error || dev.angle === null || dev.angle === undefined) return '';
            return dev.angle + '';
        },

        getTimeText(pm, omegaIdx, devIdx) {
            if (!pm || !pm.online) return '';
            if (!pm.omegas || omegaIdx >= pm.omegas.length) return '';
            var omega = pm.omegas[omegaIdx];
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
            var total = 0, online = 0, error = 0, offline = 0, pmsOnline = 0;
            var mc = { 0: 0, 1: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
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

        bulkTogglePM(idx) {
            this.bulk.selectedPMs = Object.assign({}, this.bulk.selectedPMs,
                { [idx]: !this.bulk.selectedPMs[idx] });
        },

        bulkSelectAll() {
            var all = {};
            var allSelected = true;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulk.selectedPMs[i]) allSelected = false;
                all[i] = true;
            }
            if (allSelected) {
                this.bulk.selectedPMs = {};
            } else {
                this.bulk.selectedPMs = all;
            }
        },

        bulkAllSelected() {
            if (this.cluster.length === 0) return false;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulk.selectedPMs[i]) return false;
            }
            return true;
        },

        bulkSelectMode(val) {
            this.bulk.selectedMode = (this.bulk.selectedMode === val) ? null : val;
        },

        async bulkApplyMode() {
            if (this.bulk.selectedMode === null) return;
            var selected = [];
            for (var i = 0; i < this.cluster.length; i++) {
                if (this.bulk.selectedPMs[i] && this.cluster[i].online) selected.push(this.cluster[i]);
            }
            if (selected.length === 0) return;

            this.bulk.busy = true;
            this.bulk.msg = 'Yaziliyor... (' + selected.length + ' santral)';
            var mode = this.bulk.selectedMode;

            var promises = selected.map(function(pm) {
                if (!pm.omegas) return Promise.resolve(null);
                var ids = pm.omegas.map(function(o) { return o.id; });
                var devices = [];
                for (var d = 0; d < 16; d++) devices.push(d);
                return fetch('http://' + pm.ip + ':8090/api/bulk/mode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ omega_ids: ids, devices: devices, mode: mode }),
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

            this.bulk.busy = false;
            this.bulk.msg = totalOk + '/' + totalAll + ' yazildi';
            setTimeout(() => this.loadCluster(), 2000);
        },

        bulkAngleTogglePM(idx) {
            this.bulkAngle.selectedPMs = Object.assign({}, this.bulkAngle.selectedPMs,
                { [idx]: !this.bulkAngle.selectedPMs[idx] });
        },

        bulkAngleSelectAll() {
            var all = {};
            var allSelected = true;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulkAngle.selectedPMs[i]) allSelected = false;
                all[i] = true;
            }
            this.bulkAngle.selectedPMs = allSelected ? {} : all;
        },

        bulkAngleAllSelected() {
            if (this.cluster.length === 0) return false;
            for (var i = 0; i < this.cluster.length; i++) {
                if (!this.bulkAngle.selectedPMs[i]) return false;
            }
            return true;
        },

        async bulkApplyAngle() {
            var angle = parseFloat(this.bulkAngle.angle);
            if (isNaN(angle) || angle < -60 || angle > 60) return;
            var selected = [];
            for (var i = 0; i < this.cluster.length; i++) {
                if (this.bulkAngle.selectedPMs[i] && this.cluster[i].online) selected.push(this.cluster[i]);
            }
            if (selected.length === 0) return;

            this.bulkAngle.busy = true;
            this.bulkAngle.msg = 'Yaziliyor... (' + selected.length + ' santral)';

            var promises = selected.map(function(pm) {
                if (!pm.omegas) return Promise.resolve(null);
                var ids = pm.omegas.map(function(o) { return o.id; });
                var devices = [];
                for (var d = 0; d < 16; d++) devices.push(d);
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
