const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Sadə yoxlama səhifəsi
app.get('/', (req, res) => { res.send('Bgl_ Serveri Aktivdir!'); });

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e7 // Şəkil və səs üçün fayl limitini artırırıq (10MB)
});

// Yaddaş bazamız (Server sönənə qədər dataları saxlayır)
const users = {}; // {username: {password, avatar, followers: [], following: []}}
const activeSockets = {}; // {socketId: username}

io.on('connection', (socket) => {

    // 1. Qeydiyyat və Giriş Sistemi
    socket.on('auth', (data) => {
        const { type, username, password } = data;
        
        if (!username || !password) {
            return socket.emit('auth_response', { success: false, message: 'Boş buraxma, brat!' });
        }

        if (type === 'register') {
            if (users[username]) {
                return socket.emit('auth_response', { success: false, message: 'Bu istifadəçi adı artıq götürülüb!' });
            }
            users[username] = {
                password: password,
                avatar: '',
                followers: [],
                following: []
            };
            activeSockets[socket.id] = username;
            return socket.emit('auth_response', { success: true, username, message: 'Qeydiyyat uğurlu!' });
        } 
        
        if (type === 'login') {
            if (!users[username] || users[username].password !== password) {
                return socket.emit('auth_response', { success: false, message: 'İstifadəçi adı və ya şifrə səhvdir!' });
            }
            activeSockets[socket.id] = username;
            return socket.emit('auth_response', { success: true, username, message: 'Giriş edildi!' });
        }
    });

    // 2. İstifadəçiləri Listələmək və Axtarış
    socket.on('get_users', () => {
        const currentUser = activeSockets[socket.id];
        if(!currentUser) return;

        const userList = Object.keys(users).map(name => ({
            username: name,
            avatar: users[name].avatar,
            isFollowing: users[currentUser].following.includes(name),
            followersCount: users[name].followers.length
        }));
        socket.emit('user_list', userList);
    });

    // 3. Profil Şəkli Yeniləmə
    socket.on('update_avatar', (base64Image) => {
        const username = activeSockets[socket.id];
        if (username && users[username]) {
            users[username].avatar = base64Image;
            socket.emit('avatar_updated', base64Image);
        }
    });

    // 4. Follow (Təqib) Sistemi
    socket.on('follow_user', (targetUser) => {
        const currentUser = activeSockets[socket.id];
        if (!currentUser || !users[targetUser] || currentUser === targetUser) return;

        const myFollowing = users[currentUser].following;
        const targetFollowers = users[targetUser].followers;

        if (myFollowing.includes(targetUser)) {
            // Unfollow
            users[currentUser].following = myFollowing.filter(u => u !== targetUser);
            users[targetUser].followers = targetFollowers.filter(u => u !== currentUser);
        } else {
            // Follow
            myFollowing.push(targetUser);
            targetFollowers.push(currentUser);
        }

        // Yenilənmiş məlumatı hamıya göndər
        socket.emit('follow_success', targetUser);
        io.emit('refresh_data');
    });

    // 5. Şəxsi Mesajlaşma (Özəl Çat) + Şəkil və Səs
    socket.on('private_message', (data) => {
        const sender = activeSockets[socket.id];
        const { to, text, fileType } = data; // fileType: 'text', 'image', 'audio'
        
        if (!sender) return;

        // Mesajı qəbul edəcək adamın socket ID-sini tapırıq
        const targetSocketId = Object.keys(activeSockets).find(key => activeSockets[key] === to);

        const payload = {
            from: sender,
            to: to,
            text: text,
            fileType: fileType || 'text',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // Mesajı göndərənə qaytar
        socket.emit('msg_receive', payload);

        // Əgər qarşı tərəf onlayndırsa, ona da göndər
        if (targetSocketId) {
            io.to(targetSocketId).emit('msg_receive', payload);
        }
    });

    socket.on('disconnect', () => {
        delete activeSockets[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Bgl_ işləyir...`); });
