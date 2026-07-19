const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const session = require('express-session');
const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Mengonfigurasi parser data dengan kapasitas besar (15MB) untuk menampung gambar profil kustom
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

// Set-up Session Middleware
const sessionMiddleware = session({
    secret: 'yus-super-secret-key-tempest',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// Menentukan folder target bot-wa & berkas konfigurasi panel
const BOT_DIR = path.resolve(__dirname, '../bot-wa');
const CONFIG_FILE = path.join(__dirname, 'panel-config.json');

// Tracker Kecepatan Download dan Upload Jaringan Aktif
let lastNetData = { rx: 0, tx: 0, time: Date.now() };
let currentNetSpeed = { download: "0.0 KB/s", upload: "0.0 KB/s" };

function formatBytes(bytes) {
    if (bytes === 0 || isNaN(bytes)) return '0.0 KB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function updateNetworkSpeed() {
    try {
        if (fs.existsSync('/proc/net/dev')) {
            const content = fs.readFileSync('/proc/net/dev', 'utf8');
            const lines = content.split('\n');
            let rxTotal = 0;
            let txTotal = 0;
            for (let line of lines) {
                if (line.includes(':') && !line.trim().startsWith('lo:')) {
                    const parts = line.split(':')[1].trim().split(/\s+/);
                    rxTotal += parseInt(parts[0]) || 0; // rx bytes
                    txTotal += parseInt(parts[8]) || 0; // tx bytes
                }
            }
            const now = Date.now();
            const duration = (now - lastNetData.time) / 1000; // seconds
            if (duration > 0 && lastNetData.rx > 0) {
                const rxDiff = rxTotal - lastNetData.rx;
                const txDiff = txTotal - lastNetData.tx;
                
                const rxSpeed = rxDiff / duration; // bytes/sec
                const txSpeed = txDiff / duration; // bytes/sec

                currentNetSpeed.download = formatBytes(rxSpeed);
                currentNetSpeed.upload = formatBytes(txSpeed);
            }
            lastNetData = { rx: rxTotal, tx: txTotal, time: now };
        } else {
            // Simulasi aktivitas jaringan realistis jika bukan di server Linux
            const simRx = Math.random() * 85000 + 15000; 
            const simTx = Math.random() * 25000 + 5000; 
            currentNetSpeed.download = formatBytes(simRx);
            currentNetSpeed.upload = formatBytes(simTx);
        }
    } catch (e) {
        console.error("Gagal membaca kecepatan jaringan:", e);
    }
}

// Helper untuk menghitung CPU Load secara presisi
let lastCpuTimes = getCpuTimes();
function getCpuTimes() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    if (!cpus || cpus.length === 0) return { idle: 0, total: 0 };
    cpus.forEach(cpu => {
        user += cpu.times.user;
        nice += cpu.times.nice;
        sys += cpu.times.sys;
        idle += cpu.times.idle;
        irq += cpu.times.irq;
    });
    return { idle, total: user + nice + sys + idle + irq };
}

function calculateCpuLoad() {
    const currentTimes = getCpuTimes();
    const idleDiff = currentTimes.idle - lastCpuTimes.idle;
    const totalDiff = currentTimes.total - lastCpuTimes.total;
    lastCpuTimes = currentTimes;
    if (totalDiff === 0) return "0.0";
    return (100 * (1 - idleDiff / totalDiff)).toFixed(1);
}

// Membuat folder bot-wa otomatis jika belum ada untuk menghindari error file manager
if (!fs.existsSync(BOT_DIR)) {
    try {
        fs.mkdirSync(BOT_DIR, { recursive: true });
        console.log(`[SYSTEM] Folder bot-wa dibuat otomatis di: ${BOT_DIR}`);
    } catch (e) {
        console.error("[SYSTEM] Gagal membuat folder bot-wa:", e);
    }
}

// Konfigurasi awal panel default
let panelConfig = {
    startCommand: 'npm start',
    themeColor: 'blue',
    profileName: 'Yus Developer',
    profileBio: 'WhatsApp Bot Developer',
    profileAvatar: '',
    panelOpacity: 0.85,
    panelBlur: 12,
    bgImage: '',
    textColor: '#f5f5f7',
    bgBrightness: 1.0
};

// Membaca file konfigurasi permanen jika ada
if (fs.existsSync(CONFIG_FILE)) {
    try {
        panelConfig = { ...panelConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch (e) {
        console.error("Gagal membaca file konfigurasi, menggunakan default.");
    }
}

function verifyLinuxPassword(username, password) {
    try {
        execSync(`echo "${password}" | su -c "echo success" ${username}`, { stdio: 'pipe' });
        return true;
    } catch (error) {
        return false;
    }
}

function checkAuth(req, res, next) {
    if (req.session && req.session.authenticated) return next();
    res.redirect('/login');
}

app.get('/login', (req, res) => {
    if (req.session.authenticated) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (verifyLinuxPassword(username, password)) {
        req.session.authenticated = true;
        req.session.username = username;
        return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Username atau Password Linux salah!' });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/config', checkAuth, (req, res) => {
    res.json(panelConfig);
});

app.post('/api/config', checkAuth, (req, res) => {
    try {
        panelConfig.startCommand = req.body.startCommand || 'npm start';
        panelConfig.themeColor = req.body.themeColor || 'blue';
        panelConfig.profileName = req.body.profileName || 'Yus Developer';
        panelConfig.profileBio = req.body.profileBio || '';
        panelConfig.profileAvatar = req.body.profileAvatar || '';
        panelConfig.panelOpacity = req.body.panelOpacity !== undefined ? parseFloat(req.body.panelOpacity) : 0.85;
        panelConfig.panelBlur = req.body.panelBlur !== undefined ? parseInt(req.body.panelBlur) : 12;
        panelConfig.bgImage = req.body.bgImage || '';
        panelConfig.textColor = req.body.textColor || '#f5f5f7';
        panelConfig.bgBrightness = req.body.bgBrightness !== undefined ? parseFloat(req.body.bgBrightness) : 1.0;

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(panelConfig, null, 2), 'utf8');
        res.json({ success: true, config: panelConfig });
    } catch (err) {
        console.error("Gagal menyimpan konfigurasi server:", err);
        res.status(500).json({ error: "Gagal menyimpan konfigurasi ke server." });
    }
});

app.get('/api/stats', checkAuth, (req, res) => {
    res.json(getSystemMetrics());
});

function getSystemMetrics() {
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const ramPercent = ((usedMem / totalMem) * 100).toFixed(1);
        const uptime = os.uptime();
        const osType = `${os.type()} ${os.arch()} (${os.release()})`;
        
        // Load CPU Real-Time
        const cpuLoad = calculateCpuLoad();

        // Membaca Sensor Suhu Fisik Linux laptop (Fallback jika non-Linux)
        let temp = "42.5";
        try {
            if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
                const rawTemp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
                temp = (parseFloat(rawTemp) / 1000).toFixed(1);
            } else if (fs.existsSync('/sys/class/thermal/thermal_zone1/temp')) {
                const rawTemp = fs.readFileSync('/sys/class/thermal/thermal_zone1/temp', 'utf8');
                temp = (parseFloat(rawTemp) / 1000).toFixed(1);
            } else {
                temp = (40 + (parseFloat(cpuLoad) * 0.22) + Math.sin(Date.now() / 15000) * 1.2).toFixed(1);
            }
        } catch (e) {
            temp = "44.0";
        }

        // Konsumsi Daya Real-Time (Membaca semua kemungkinan slot baterai Linux & desktop fallback)
        let watt = "12.5";
        let batteryFound = false;
        let wattVal = 0;
        try {
            const powerSupplies = ['BAT0', 'BAT1', 'BAT2'];
            for (let bat of powerSupplies) {
                const powerPath = `/sys/class/power_supply/${bat}/power_now`;
                const currentPath = `/sys/class/power_supply/${bat}/current_now`;
                const voltagePath = `/sys/class/power_supply/${bat}/voltage_now`;
                if (fs.existsSync(powerPath)) {
                    const microwatts = parseInt(fs.readFileSync(powerPath, 'utf8').trim());
                    wattVal = microwatts / 1000000;
                    batteryFound = true;
                    break;
                } else if (fs.existsSync(currentPath) && fs.existsSync(voltagePath)) {
                    const microamps = parseInt(fs.readFileSync(currentPath, 'utf8').trim());
                    const microvolts = parseInt(fs.readFileSync(voltagePath, 'utf8').trim());
                    wattVal = (microamps * microvolts) / 1000000000000;
                    batteryFound = true;
                    break;
                }
            }
        } catch (e) {
            batteryFound = false;
        }

        // Estimasi cerdas untuk server awan / komputer desktop tanpa baterai
        if (!batteryFound || wattVal === 0) {
            const parsedCpu = parseFloat(cpuLoad) || 0.0;
            const baseWatt = 14.5; // Konsumsi idle normal desktop/laptop
            const dynamicWatt = (parsedCpu * 0.42); // 100% CPU menambahkan ~42 Watt
            const fluctuation = Math.sin(Date.now() / 4000) * 0.7; // Fluktuasi tegangan normal
            wattVal = baseWatt + dynamicWatt + fluctuation;
        }
        watt = wattVal.toFixed(1);

        // Kapasitas Baterai Laptop & Status Charger
        let batteryLevel = 100;
        let isCharging = true;
        let batteryStatus = "AC Power";
        try {
            if (fs.existsSync('/sys/class/power_supply/BAT0/capacity')) {
                batteryLevel = parseInt(fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf8').trim());
                const status = fs.readFileSync('/sys/class/power_supply/BAT0/status', 'utf8').trim().toLowerCase();
                isCharging = status === 'charging' || status === 'full';
                batteryStatus = isCharging ? (status === 'full' ? 'Fully Charged' : 'Charging') : 'Discharging';
            } else if (fs.existsSync('/sys/class/power_supply/BAT1/capacity')) {
                batteryLevel = parseInt(fs.readFileSync('/sys/class/power_supply/BAT1/capacity', 'utf8').trim());
                const status = fs.readFileSync('/sys/class/power_supply/BAT1/status', 'utf8').trim().toLowerCase();
                isCharging = status === 'charging' || status === 'full';
                batteryStatus = isCharging ? (status === 'full' ? 'Fully Charged' : 'Charging') : 'Discharging';
            } else {
                batteryLevel = 100;
                isCharging = true;
                batteryStatus = "AC Power Connected";
            }
        } catch (e) {
            batteryLevel = 100;
            isCharging = true;
        }

        return {
            cpu: cpuLoad,
            cpuModel: os.cpus()[0]?.model || "Intel/AMD Processor",
            cpuSpeed: os.cpus()[0]?.speed || 0,
            cpuCores: os.cpus().length,
            ram: {
                used: (usedMem / (1024 ** 3)).toFixed(2) + " GB",
                total: (totalMem / (1024 ** 3)).toFixed(2) + " GB",
                percent: ramPercent
            },
            watt: watt,
            temp: temp,
            battery: {
                level: batteryLevel,
                charging: isCharging,
                status: batteryStatus
            },
            uptime: uptime,
            os: osType,
            hostname: os.hostname(),
            network: currentNetSpeed,
            timestamp: Date.now()
        };
    } catch (err) {
        return { cpu: "0.0", cpuModel: "Processor", cpuSpeed: 0, cpuCores: 1, ram: { used: "0 GB", total: "0 GB", percent: "0" }, watt: "15.0", temp: "45", battery: { level: 100, charging: true, status: "AC" }, uptime: 0, os: "Unknown OS", network: { download: "0.0 KB/s", upload: "0.0 KB/s" } };
    }
}

app.get('/api/files', checkAuth, (req, res) => {
    const targetDir = path.join(BOT_DIR, req.query.path || '');
    if (!targetDir.startsWith(BOT_DIR)) return res.status(403).json({ error: 'Akses ilegal di luar direktori bot!' });

    fs.readdir(targetDir, { withFileTypes: true }, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        try {
            const list = files.map(f => {
                const fullPath = path.join(targetDir, f.name);
                let sizeStr = "-";
                if (!f.isDirectory() && fs.existsSync(fullPath)) {
                    const stats = fs.statSync(fullPath);
                    sizeStr = (stats.size / 1024).toFixed(2) + ' KB';
                }
                return {
                    name: f.name,
                    isDirectory: f.isDirectory(),
                    size: sizeStr
                };
            });
            res.json({ currentPath: path.relative(BOT_DIR, targetDir), files: list });
        } catch (e) {
            res.status(500).json({ error: 'Gagal membaca ukuran file.' });
        }
    });
});

app.get('/api/read', checkAuth, (req, res) => {
    const filePath = path.join(BOT_DIR, req.query.path || '');
    if (!filePath.startsWith(BOT_DIR)) return res.status(403).json({ error: 'Akses ilegal!' });
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Gagal membaca berkas file.' });
        res.json({ content: data });
    });
});

app.post('/api/write', checkAuth, (req, res) => {
    const filePath = path.join(BOT_DIR, req.query.path || '');
    if (!filePath.startsWith(BOT_DIR)) return res.status(403).json({ error: 'Akses ilegal!' });
    fs.writeFile(filePath, req.body.content || '', 'utf8', (err) => {
        if (err) return res.status(500).json({ error: 'Gagal menulis file.' });
        res.json({ success: true });
    });
});

app.get('/api/download', checkAuth, (req, res) => {
    const filePath = path.join(BOT_DIR, req.query.path || '');
    if (!filePath.startsWith(BOT_DIR)) return res.status(403).end();
    res.download(filePath);
});

app.post('/api/upload', checkAuth, (req, res) => {
    const targetPath = path.join(BOT_DIR, req.query.path || '');
    if (!targetPath.startsWith(BOT_DIR)) return res.status(403).json({ error: 'Akses ilegal!' });
    fs.writeFile(targetPath, req.body, (err) => {
        if (err) return res.status(500).json({ error: 'Gagal mengunggah biner file.' });
        res.json({ success: true });
    });
});

app.post('/api/move', checkAuth, (req, res) => {
    const oldPath = path.join(BOT_DIR, req.body.oldPath || '');
    const newPath = path.join(BOT_DIR, req.body.newPath || '');
    if (!oldPath.startsWith(BOT_DIR) || !newPath.startsWith(BOT_DIR)) {
        return res.status(403).json({ error: 'Akses ilegal!' });
    }
    fs.rename(oldPath, newPath, (err) => {
        if (err) return res.status(500).json({ error: 'Gagal memindahkan file.' });
        res.json({ success: true });
    });
});

app.post('/api/unzip', checkAuth, (req, res) => {
    const zipFilePath = path.join(BOT_DIR, req.body.path || '');
    if (!zipFilePath.startsWith(BOT_DIR)) return res.status(403).json({ error: 'Akses ilegal!' });

    const targetExtractDir = path.dirname(zipFilePath);
    const escapedZipPath = zipFilePath.replace(/(["\s'$`\\])/g, '\\$1');
    const escapedExtractDir = targetExtractDir.replace(/(["\s'$`\\])/g, '\\$1');

    exec(`unzip -o ${escapedZipPath} -d ${escapedExtractDir}`, (err, stdout, stderr) => {
        if (err) {
            return res.status(500).json({ 
                error: "Sistem gagal mengekstrak ZIP.", 
                details: stderr || err.message 
            });
        }
        res.json({ success: true, output: stdout });
    });
});

// === STORAGE LOG GLOBAL (BUFFER) ===
let activeProcess = null;
let logBuffer = [];          // Menyimpan riwayat log terakhir di memori
const MAX_LOG_LINES = 1000;  // Batas riwayat log agar tidak makan memori RAM

// Fungsi pembantu untuk mengumpulkan log dan menyebarkannya ke SEMUA admin yang online
function appendAndBroadcastLog(data) {
    const stringData = data.toString();
    logBuffer.push(stringData);
    
    // Potong array jika sudah melebihi batas baris log yang diizinkan
    if (logBuffer.length > MAX_LOG_LINES) {
        logBuffer.shift();
    }
    
    // Siarkan ke seluruh socket yang terhubung secara realtime
    io.emit('log', stringData);
}

// === SOCKET ENGINE ===
io.on('connection', (socket) => {
    if (!socket.request.session || !socket.request.session.authenticated) {
        return socket.disconnect(true);
    }

    // Kirim status dan data telemetri pertama saat admin baru masuk
    socket.emit('status', activeProcess ? 'RUNNING' : 'OFFLINE');
    socket.emit('live-metrics', getSystemMetrics());
    
    // PERBAIKAN UTAMA: Kirimkan riwayat log lama yang tersimpan di buffer 
    // sehingga saat refresh/ganti tab log lama tidak akan hilang.
    if (logBuffer.length > 0) {
        socket.emit('log', logBuffer.join(''));
    }

    socket.on('command', (commandText) => {
        if (!commandText) return;
        
        if (activeProcess) {
            // Tampilkan input perintah ke log global
            appendAndBroadcastLog(`> ${commandText}\n`);
            try {
                activeProcess.stdin.write(commandText + '\n');
            } catch (e) {
                appendAndBroadcastLog(`[ERROR] Gagal input ke proses: ${e.message}\n`);
            }
        } else {
            // Jalankan shell interaktif sekali jalan (one-off shell execution)
            appendAndBroadcastLog(`\x1b[33m[SHELL]\x1b[0m yus-dev@server:${path.basename(BOT_DIR)}$ ${commandText}\n`);
            try {
                const tempProcess = spawn(commandText, [], { cwd: BOT_DIR, shell: true });
                tempProcess.stdout.on('data', data => appendAndBroadcastLog(data));
                tempProcess.stderr.on('data', data => appendAndBroadcastLog(`[ERROR] ${data}`));
                tempProcess.on('close', (code) => {
                    appendAndBroadcastLog(`[SHELL] Perintah selesai dengan kode: ${code}\n`);
                });
            } catch (err) {
                appendAndBroadcastLog(`[ERROR] Gagal menjalankan perintah shell: ${err.message}\n`);
            }
        }
    });

    socket.on('action', (actionName) => {
        if (actionName === 'START') {
            if (activeProcess) return socket.emit('log', '[SYSTEM] Proses masih berjalan!\n');
            
            io.emit('status', 'STARTING');
            const cmdString = panelConfig.startCommand;
            appendAndBroadcastLog(`[SYSTEM] Menjalankan perintah kustom: ${cmdString}...\n`);

            activeProcess = spawn(cmdString, [], { cwd: BOT_DIR, shell: true });
            
            // Ikat event output ke helper penyiar global
            activeProcess.stdout.on('data', data => appendAndBroadcastLog(data));
            activeProcess.stderr.on('data', data => appendAndBroadcastLog(`[ERROR] ${data}`));
            activeProcess.on('close', (code) => {
                activeProcess = null;
                io.emit('status', 'OFFLINE');
                appendAndBroadcastLog(`[SYSTEM] Proses selesai dengan kode: ${code}\n`);
            });
        }

        if (actionName === 'INSTALL') {
            if (activeProcess) return socket.emit('log', '[SYSTEM] Harap stop proses yang berjalan dahulu!\n');
            
            io.emit('status', 'INSTALLING');
            appendAndBroadcastLog(`[SYSTEM] Menjalankan: npm install...\n`);

            activeProcess = spawn('npm', ['install'], { cwd: BOT_DIR, shell: true });
            
            activeProcess.stdout.on('data', data => appendAndBroadcastLog(data));
            activeProcess.stderr.on('data', data => appendAndBroadcastLog(`[ERROR] ${data}`));
            activeProcess.on('close', (code) => {
                activeProcess = null;
                io.emit('status', 'OFFLINE');
                appendAndBroadcastLog(`[SYSTEM] npm install selesai dengan kode: ${code}\n`);
            });
        }

        if (actionName === 'STOP') {
            if (activeProcess) {
                appendAndBroadcastLog('[SYSTEM] Menghentikan proses paksa...\n');
                activeProcess.kill('SIGINT');
                activeProcess = null;
                io.emit('status', 'OFFLINE');
            }
        }
    });
});

// Broadcaster Telemetri 1 Detik Terjadwal
setInterval(() => {
    updateNetworkSpeed();
    io.emit('live-metrics', getSystemMetrics());
}, 1000);

http.listen(3000, () => console.log(`🚀 Secure Custom Panel running di http://localhost:3000`));
