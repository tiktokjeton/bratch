const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

// MongoDB bağlantısı
const dbURI = 'mongodb+srv://bgl:120225Aa@cluster0.xt29nec.mongodb.net/?appName=Cluster0';
mongoose.connect(dbURI)
  .then(() => console.log('Baza aktivdir!'))
  .catch(err => console.log('Baza xətası:', err));

// İstifadəçi modeli - Bio və Şəkil üçün sahələr əlavə olundu
const UserSchema = new mongoose.Schema({
    username: String,
    password: String,
    avatar: String,
    bio: { type: String, default: '' },
    following: [String],
    followers: [String]
});
const User = mongoose.model('User', UserSchema);

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e7 // 10MB limit
});

const activeSockets = {}; 

io.on('connection', (socket) => {
    // 1. Qeydiyyat və Giriş
    socket.on('auth', async (data) => {
        const { type, username, password } = data;
        if (type === 'register') {
            const existing = await User.findOne({ username });
            if (existing) return socket.emit('auth_response', { success: false, message: 'İstifadəçi var!' });
            await User.create({ username, password, avatar: '', bio: '', following: [], followers: [] });
            activeSockets[socket.id] = username;
            socket.emit('auth_response', { success: true, username });
        } else if (type === 'login') {
            const user = await User.findOne({ username, password });
            if (!user) return socket.emit('auth_response', { success: false, message: 'Səhv məlumat!' });
            activeSockets[socket.id] = username;
            socket.emit('auth_response', { success: true, username });
        }
    });

    // 2. "Yazır..." funksiyası
    socket.on('typing', (data) => {
        socket.broadcast.emit('user_typing', { from: activeSockets[socket.id], to: data.to });
    });

    socket.on('stop_typing', (data) => {
        socket.broadcast.emit('user_stopped_typing', { from: activeSockets[socket.id] });
    });

    // 3. Profil yeniləmə
    socket.on('update_profile', async (data) => {
        const username = activeSockets[socket.id];
        await User.updateOne({ username }, { bio: data.bio, avatar: data.avatar });
        socket.emit('profile_updated', { success: true });
    });

    socket.on('disconnect', () => delete activeSockets[socket.id]);
});

server.listen(3000, () => console.log('Server 3000-ci portda işləyir...'));
