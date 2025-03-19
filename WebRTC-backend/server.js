import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import cors from 'cors'
 
const port = 8000;

const app = express();
const server = createServer(app);
const allusers = {};
const socketToUser = {};
const users = ["Shivraj", "mayur"];
let connectedUsers = {};

const __dirname = dirname(fileURLToPath(import.meta.url));


app.use(cors({
    origin: "http://localhost:5173", // Allow requests from this origin
    credentials: true, // Allow credentials (cookies, authorization headers, etc.)
}));

// Configure CORS for Socket.IO
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173", // Allow Socket.IO connections from this origin
        methods: ["GET", "POST"], // Allowed HTTP methods
        credentials: true, // Allow credentials
    },
});
// Middleware
app.use(express.static(join(__dirname, 'public')));
app.use(express.json()); // Parse JSON request bodies


// Routes
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, "/app/index.html"));
});

const fetchUsers = async () => {
    try {
        // const donor = await Donor.findOne({}); // Fetch the first donor
        // const ngo = await Ngo.findOne({}); // Fetch the first NGO

        if (!donor || !ngo) {
            throw new Error("Donor or NGO not found in the database");
        }

        return [donor.name, ngo.name]; // Return the names of the donor and NGO
    } catch (error) {
        console.error("Error fetching users from database:", error);
        return []; // Return an empty array if there's an error
    }
};

// Socket.io event handling
io.on('connection', (socket) => {
    // const users = await fetchUsers();
    let assignedUser = users.find(user => !connectedUsers[user]);
    
    if (!assignedUser) {
        console.log("Both users are already connected.");
        socket.disconnect();
        return;
    }

    connectedUsers[assignedUser] = { socketId: socket.id, username: assignedUser };
    // Also add to allusers for consistency
    allusers[assignedUser] = { id: socket.id, username: assignedUser };
    socketToUser[socket.id] = assignedUser;
    
    // console.log(${assignedUser} connected);

    // Notify the connected user of their assigned ID
    socket.emit("user-assigned", { userId: assignedUser });

    // Update contact list for both users
    io.emit("update-contacts", connectedUsers);
    io.emit("joined", allusers);

    socket.on("disconnect", () => {
        // console.log(${assignedUser} disconnected);
        delete connectedUsers[assignedUser];
        delete allusers[assignedUser];
        delete socketToUser[socket.id];

        io.emit("update-contacts", connectedUsers);
        io.emit("joined", allusers);
    });

    socket.on("call-request", ({ from, to }) => {
        // console.log(${from} is calling ${to});
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("call-request", { from });
        }
    });

    socket.on("call-accepted", ({ from, to }) => {
        console.log(`${to} accepted call from ${from}`);
        
        // Validate that both from and to are not empty
        if (!from || !to) {
            console.log(`Invalid call acceptance: from=${from}, to=${to}`);
            return;
        }
        
        if (connectedUsers[from]) {
            io.to(connectedUsers[from].socketId).emit("call-accepted", { from, to });
        } else {
            console.log(`User ${from} not found in connected users`);
        }
    });

    socket.on("offer", ({ from, to, offer }) => {
        console.log(`Offer from ${from} to ${to}`);
        
        // Validate that both from and to are not empty
        if (!from || !to) {
            console.log(`Invalid offer: from=${from}, to=${to}`);
            return;
        }
        
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("offer", { from, to, offer });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    socket.on("call-canceled", ({ from, to }) => {
        console.log(`Call from ${from} to ${to} was canceled`);
    
        // Notify User B that the call was canceled (if they haven't answered yet)
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("call-canceled", { from });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    
        // Prevent the missed call notification from triggering
        if (allusers[to]?.id) {
            const targetSocket = io.sockets.sockets.get(allusers[to].id);
            if (targetSocket && targetSocket.missedCallTimeout) {
                clearTimeout(targetSocket.missedCallTimeout);
                delete targetSocket.missedCallTimeout;
            }
        }
    });
    
    socket.on("answer", ({ from, to, answer }) => {
        console.log(`Received answer from ${to} to ${from}`);
        
        // Validate that both from and to are not empty
        if (!from || !to) {
            console.log(`Invalid answer: from=${from}, to=${to}`);
            return;
        }
        
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("answer", { from, to, answer });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    socket.on("end-call", ({ from, to }) => {
        console.log(`Call ending notification from ${from} to ${to}`);
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("end-call", { from, to });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    socket.on("call-ended", caller => {
        // Check if caller is an object with from and to properties
        const from = caller?.from || '';
        const to = caller?.to || '';
        console.log(`Call ended between ${from} and ${to}`);
        
        // Validate that both from and to are not empty
        if (!from || !to) {
            console.log(`Invalid call-ended: from=${from}, to=${to}`);
            return;
        }
        
        if (connectedUsers[from]) {
            io.to(connectedUsers[from].socketId).emit("call-ended", caller);
            // Clear the missed call timeout if it exists
            const socketId = connectedUsers[from].socketId;
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.missedCallTimeout) {
                clearTimeout(socket.missedCallTimeout);
                delete socket.missedCallTimeout;
            }
        } else {
            console.log(`User ${from} not found in connected users`);
        }
        
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("call-ended", caller);
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    socket.on("icecandidate", ({ candidate, to }) => {
        console.log(`ICE Candidate for ${to}`);
        
        // Validate that to is not empty
        if (!to) {
            console.log(`Invalid ICE candidate: to=${to}`);
            return;
        }
        
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("icecandidate", { candidate });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    // Add camera toggle event handlers
    socket.on("camera-toggle", ({ from, to, isEnabled }) => {
        console.log(`Camera ${isEnabled ? 'enabled' : 'disabled'} by ${from}`);
        
        // Validate that both from and to are not empty
        if (!from || !to) {
            console.log(`Invalid camera toggle: from=${from}, to=${to}`);
            return;
        }
        
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("remote-camera-toggle", { 
                from, 
                isEnabled 
            });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    // Add video track update handler for when camera is re-enabled
    socket.on("video-track-update", ({ from, to, track }) => {
        console.log(`Video track updated by ${from}`);
        
        // Validate that both from and to are not empty
        if (!from || !to) {
            console.log(`Invalid video track update: from=${from}, to=${to}`);
            return;
        }
        
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("remote-video-track-update", { 
                from, 
                track 
            });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    // Add microphone toggle event handlers
    socket.on("mic-toggle", ({ from, to, isEnabled }) => {
        console.log(`Microphone ${isEnabled ? 'enabled' : 'disabled'} by ${from}`);
        
        // Validate that both from and to are not empty
        if (!from || !to) {
            console.log(`Invalid mic toggle: from=${from}, to=${to}`);
            return;
        }
        
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("remote-mic-toggle", { 
                from, 
                isEnabled 
            });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    // Add reconnection handler
    socket.on("reconnect-request", ({ from, to }) => {
        console.log(`Reconnection requested by ${from} to ${to}`);
        
        // Validate that both from and to are not empty
        if (!from || !to) {
            console.log(`Invalid reconnection request: from=${from}, to=${to}`);
            return;
        }
        
        if (connectedUsers[to]) {
            io.to(connectedUsers[to].socketId).emit("reconnect-request", { from });
        } else {
            console.log(`User ${to} not found in connected users`);
        }
    });

    socket.on("call-rejected", ({ from, to }) => {
        console.log(`Call from ${from} to ${to} was rejected`);
        if (connectedUsers[from]) {
            io.to(connectedUsers[from].socketId).emit("call-rejected", { from, to });
            
            const socketId = connectedUsers[from].socketId;
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.missedCallTimeout) {
                clearTimeout(socket.missedCallTimeout);
                delete socket.missedCallTimeout;
            }
            // Send missed call notification to the caller
            sendMissedCallNotification(to, from);
        } else {
            console.log(`User ${from} not found in connected users`);
        }
    });
});

// Function to send missed call notification
const sendMissedCallNotification = (from, to) => {
    console.log(`Sending missed call notification from ${from} to ${to}`);
    if (connectedUsers[to]) {
        io.to(connectedUsers[to].socketId).emit("missed-call", { from });
    } else {
        console.log(`Cannot send missed call notification: User ${to} not found in connected users`);
    }
};

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Visit http://localhost:${port} to access the application`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Server shutting down');
    server.close(() => {
        console.log('Server stopped');
        process.exit(0);
    });
});