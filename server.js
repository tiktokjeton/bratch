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
  .then(() => console.log('Brat, Baza (MongoDB) aktivdir!'))
  .catch(err => console.log('Baza xətası:', err));

// ==========================================
// 1. MƏLUMAT BAZASI MODELLƏRİ (Mongoose)
// ==========================================

// İstifadəçi Modeli
const UserSchema = new mongoose.Schema({
    username: String,
    password: String,
    avatar: { type: String, default: '' },
    bio: { type: String, default: '' },
    following: [String],
    followers: [String]
});
const User = mongoose.model('User', UserSchema);

// Post (Keşfet) Modeli
const PostSchema = new mongoose.Schema({
    author: String,
    image: String,
    description: String,
    timestamp: Number,
    likes: { type: Number, default: 0 },
    comments: [{ author: String, text: String }]
});
const Post = mongoose.model('Post', PostSchema);

// Mesaj (Chat) Modeli
const MessageSchema = new mongoose.Schema({
    from: String,
    to: String,
    text: String,
    fileType: String,
    timestamp: { type: Number, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// ==========================================
// 2. SOCKET.IO VƏ SERVER AYARLARI
// ==========================================

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 5e7 // 50MB limitə qaldırıldı ki, şəkillər silinməsin və çökməsin
});

const activeSockets = {}; // Kimlərin online olduğunu izləmək üçün

io.on('connection', (socket) => {
    
    // --- AUTH (Qeydiyyat və Giriş) ---
    socket.on('auth', async (data) => {
        const { type, username, password } = data;
        
        if (type === 'register') {
            const existing = await User.findOne({ username });
            if (existing) {
                return socket.emit('auth_response', { success: false, message: 'Bu adda istifadəçi artıq var, başqa ad seçin.' });
            }
            const newUser = await User.create({ username, password, avatar: '', bio: '', following: [], followers: [] });
            activeSockets[socket.id] = username;
            
            // Qeydiyyatdan sonra token göndərilir
            socket.emit('auth_response', { success: true, username, token: newUser._id, following: [] });
            io.emit('user_status', { username, online: true }); 
            
        } else if (type === 'login') {
            const user = await User.findOne({ username });
            if (!user) {
                return socket.emit('auth_response', { success: false, message: 'Hesabınız yoxdur, zəhmət olmasa hesab yaradın.' });
            }
            if (user.password !== password) {
                return socket.emit('auth_response', { success: false, message: 'Şifrə səhvdir, yenidən yoxlayın.' });
            }
            
            activeSockets[socket.id] = username;
            
            // Giriş edəndə profili və TOKEN-i göndər ki, sayt dərhal tanısın və yadda saxlasın
            socket.emit('auth_response', { 
                success: true, 
                username, 
                avatar: user.avatar,
                followersCount: user.username === 'bgl_' ? 1000000 : user.followers.length,
                following: user.following, // Bura əlavə edildi ki, Front-end kimləri izlədiyini bilsin
                token: user._id 
            });
            io.emit('user_status', { username, online: true });
        }
    });

    // --- AVTOMATİK GİRİŞ (Səhifə yenilənəndə istifadəçini tanımaq üçün əlavə edildi) ---
    socket.on('auto_login', async (token) => {
        try {
            const user = await User.findById(token);
            if (user) {
                activeSockets[socket.id] = user.username;
                socket.emit('auth_response', { 
                    success: true, 
                    username: user.username, 
                    avatar: user.avatar,
                    followersCount: user.username === 'bgl_' ? 1000000 : user.followers.length,
                    following: user.following, // Bura əlavə edildi ki, səhifə yenilənəndə məlumat itməsin
                    token: user._id
                });
                io.emit('user_status', { username: user.username, online: true });
            }
        } catch (err) {
            console.log("Token yoxlanarkən xəta oldu və ya istifadəçi tapılmadı.");
        }
    });

    // --- İSTİFADƏÇİ SİYAHISI ---
    socket.on('get_users', async () => {
        const users = await User.find({});
        const userList = users.map(u => ({
            username: u.username,
            avatar: u.avatar,
            followersCount: u.username === 'bgl_' ? 1000000 : u.followers.length, // bgl_ üçün 1M
            online: Object.values(activeSockets).includes(u.username)
        }));
        socket.emit('user_list', userList);
    });

    // --- PROFİL MƏLUMATLARINI GƏTİRMƏK ---
    socket.on('get_user_profile', async (targetUsername) => {
        const user = await User.findOne({ username: targetUsername });
        if(user) {
            socket.emit('user_profile_data', {
                username: user.username,
                avatar: user.avatar,
                bio: user.bio,
                followers: user.followers,
                following: user.following,
                followersCount: user.username === 'bgl_' ? 1000000 : user.followers.length, // bgl_ üçün 1M
                followingCount: user.following.length
            });
        }
    });

    // --- FOLLOW / UNFOLLOW SİSTEMİ ---
    socket.on('follow_user', async (data) => {
        const current_user = activeSockets[socket.id];
        const target_user = data.target;
        if (!current_user || !target_user) return;

        const me = await User.findOne({ username: current_user });
        const target = await User.findOne({ username: target_user });
        
        if (me && target && current_user !== target_user && !me.following.includes(target_user)) {
            me.following.push(target_user);
            target.followers.push(current_user);
            await me.save();
            await target.save();
            io.emit('follow_updated', { 
                target_user, 
                followersCount: target_user === 'bgl_' ? 1000000 : target.followers.length 
            });
        }
    });

    socket.on('unfollow_user', async (data) => {
        const current_user = activeSockets[socket.id];
        const target_user = data.target;
        if (!current_user || !target_user) return;

        const me = await User.findOne({ username: current_user });
        const target = await User.findOne({ username: target_user });
        
        if (me && target && current_user !== target_user && me.following.includes(target_user)) {
            me.following = me.following.filter(u => u !== target_user);
            target.followers = target.followers.filter(u => u !== current_user);
            await me.save();
            await target.save();
            io.emit('follow_updated', { 
                target_user, 
                followersCount: target_user === 'bgl_' ? 1000000 : target.followers.length 
            });
        }
    });

    // --- KEŞFET VƏ POSTLAR ---
    socket.on('create_post', async (postData) => {
        await Post.create({
            author: postData.author,
            image: postData.image,
            description: postData.description,
            timestamp: postData.timestamp || Date.now()
        });
        
        const allPosts = await Post.find().sort({ timestamp: -1 }); 
        io.emit('explore_posts', allPosts);
    });

    socket.on('get_explore_posts', async () => {
        const allPosts = await Post.find().sort({ timestamp: -1 });
        socket.emit('explore_posts', allPosts);
    });

    // --- MESAJLAŞMA (Chat) VƏ BİLDİRİŞLƏR ---
    socket.on('private_message', async (msgData) => {
        const { to, text, fileType } = msgData;
        const from = activeSockets[socket.id];
        if(!from) return;
        
        const newMessage = await Message.create({ 
            from, to, text, fileType, timestamp: Date.now() 
        });
        
        const messageObj = { from, to, text, fileType, timestamp: newMessage.timestamp };
        
        socket.emit('msg_receive', messageObj);
        
        for (let [id, uname] of Object.entries(activeSockets)) {
            if (uname === to) {
                io.to(id).emit('msg_receive', messageObj);
                io.to(id).emit('new_notification', { from, text: 'Sizə yeni mesaj var!' }); 
            }
        }
    });

    socket.on('get_chat_history', async (data) => {
        const { user1, user2 } = data;
        const history = await Message.find({
            $or: [
                { from: user1, to: user2 },
                { from: user2, to: user1 }
            ]
        }).sort({ timestamp: 1 });
        socket.emit('chat_history', history);
    });

    // --- YAZIR... FUNKSİYASI ---
    socket.on('typing', (data) => {
        for (let [id, uname] of Object.entries(activeSockets)) {
            if (uname === data.to) {
                io.to(id).emit('typing', { from: activeSockets[socket.id] });
            }
        }
    });

    socket.on('stop_typing', (data) => {
        for (let [id, uname] of Object.entries(activeSockets)) {
            if (uname === data.to) {
                io.to(id).emit('stop_typing', { from: activeSockets[socket.id] });
            }
        }
    });

    // --- AVATAR (PROFİL ŞƏKLİ) YENİLƏMƏSİ ---
    socket.on('update_avatar', async (avatarBase64) => {
        const username = activeSockets[socket.id];
        if (username) {
            await User.updateOne({ username }, { avatar: avatarBase64 });
            socket.emit('avatar_updated', avatarBase64);
            
            const users = await User.find({});
            const userList = users.map(u => ({
                username: u.username,
                avatar: u.avatar,
                followersCount: u.username === 'bgl_' ? 1000000 : u.followers.length,
                online: Object.values(activeSockets).includes(u.username)
            }));
            io.emit('user_list', userList);
        }
    });

    // --- PROFİL YENİLƏMƏ ---
    socket.on('update_profile', async (data) => {
        const username = activeSockets[socket.id];
        if (username) {
            await User.updateOne({ username }, { bio: data.bio, avatar: data.avatar });
            socket.emit('profile_updated', { success: true });
            
            if(data.avatar) {
                socket.emit('avatar_updated', { username, avatar: data.avatar });
            }
        }
    });

    // --- ÇIXIŞ (Disconnect) ---
    socket.on('disconnect', () => {
        const username = activeSockets[socket.id];
        if (username) {
            io.emit('user_status', { username, online: false });
            delete activeSockets[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => console.log(`Server ${PORT}-cu portda işləyir, uğurlar brat...`));
