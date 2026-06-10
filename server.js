// server.js - sadəcə socket-ləri birbaşa yadda saxlayırıq
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// Mesajlar yaddaşı (təxmini)
const messageHistory = {}; // { "userA-userB": [messages] }

io.on('connection', (socket) => {
    socket.on('join', (username) => {
        activeSockets[socket.id] = username;
    });

    socket.on('private_message', (data) => {
        const { to, text, fileType } = data;
        const sender = activeSockets[socket.id];
        const room = [sender, to].sort().join('-');
        
        if(!messageHistory[room]) messageHistory[room] = [];
        
        const msg = { from: sender, to, text, fileType, time: new Date().toLocaleTimeString() };
        messageHistory[room].push(msg);
        
        io.to(to).emit('msg_receive', msg); // Burda to-nu düzgün yönləndirməliyik
    });
});
