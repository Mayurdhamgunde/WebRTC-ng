const createUserBtn = document.getElementById("create-user");
const username = document.getElementById("username");
const allusersHtml = document.getElementById("allusers");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const endCallBtn = document.getElementById("end-call-btn");
const notificationContainer = document.getElementById("notification-container");
const screenShareBtn = document.getElementById("screen-share-btn");
const cameraToggle = document.getElementById("camera-toggle");
const audioToggle = document.getElementById("audio-toggle");
let isAudioOn = true
let isCameraOn = true;
let pendingOffer = null;
const socket = io();
let screenStream = null;
let localStream;
let caller = [];
let remoteUser = null;
const pendingIceCandidates = [];
let callingNotificationTimeout; 
const pendingCalls = new Map();

// Check URL parameters for notification actions
window.addEventListener('load', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const callerParam = urlParams.get('caller');
    
    if (action === 'answer' && callerParam) {
        console.log('Auto-answering call from:', callerParam);
        // Will be handled once the user is logged in
        window.pendingAutoAnswer = callerParam;
    }
});

const peerConnection = (function () {
    let peerConnection = null;

    const createPeerConnection = () => {
        const config = {
            iceServers: [
                {
                    urls: 'stun:stun.l.google.com:19302'
                }
            ]
        };
        peerConnection = new RTCPeerConnection(config);

        if (localStream) {
            // Check if tracks are already added
            const senders = peerConnection.getSenders();
            const trackKinds = senders.map(sender => sender.track?.kind);
            
            localStream.getTracks().forEach(track => {
                // Only add the track if a sender with this track kind doesn't exist
                if (!trackKinds.includes(track.kind)) {
                    console.log("Adding local track:", track.kind);
                    peerConnection.addTrack(track, localStream);
                } else {
                    console.log("Track already exists. Skipping addTrack for:", track.kind);
                }
            });
        }

        peerConnection.ontrack = function (event) {
            remoteVideo.srcObject = event.streams[0];
        };

        peerConnection.onicecandidate = function (event) {
            if (event.candidate) {
                console.log("Sending ICE candidate:", event.candidate);
                socket.emit("icecandidate", { candidate: event.candidate, to: remoteUser });
            }
        };


        return peerConnection;
    };

    return {
        getInstance: () => {
            if (!peerConnection) {
                peerConnection = createPeerConnection();
            }
            return peerConnection;
        },
        reset: () => {
            if (peerConnection) {
                console.log("Resetting PeerConnection...");
                peerConnection.getSenders().forEach(sender => {
                    peerConnection.removeTrack(sender);
                });
                peerConnection.close();
                peerConnection = null;
            }
        }
    };
})();


audioToggle.addEventListener("click", () => {
    if (isAudioOn) {
        // Mute the audio
        localStream.getAudioTracks().forEach(track => (track.enabled = false));
        audioToggle.src = "/js/images/mic-off.png"; // Change to "mic off" image
        isAudioOn = false;
    } else {
        // Unmute the audio
        localStream.getAudioTracks().forEach(track => (track.enabled = true));
        audioToggle.src = "/js/images/mic-on.png"; // Change to "mic on" image
        isAudioOn = true;
    }
});

cameraToggle.addEventListener("click", async () => {
    if (isCameraOn) {
        // Turn off the camera
        localStream.getVideoTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        cameraToggle.src = "/js/images/camera-off.png"; // Change image to "camera off" state
        isCameraOn = false;
    } else {
        // Turn on the camera
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream = stream;
            localVideo.srcObject = stream;
            cameraToggle.src = "/js/images/camera-on.png"; // Change image to "camera on" state
            isCameraOn = true;
        } catch (error) {
            console.error("Error accessing camera:", error);
        }
    }
});


screenShareBtn.addEventListener("click", async () => {
    if (!screenStream) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const pc = peerConnection.getInstance();

            const screenTrack = screenStream.getVideoTracks()[0];
            const sender = pc.getSenders().find(sender => sender.track.kind === "video");
            if (sender) {
                sender.replaceTrack(screenTrack);
            }

            screenShareBtn.textContent = "Stop Sharing";
            screenShareBtn.style.backgroundColor = "#f44336";
        } catch (error) {
            console.error("Error sharing screen:", error);
        }
    } else {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;

        const pc = peerConnection.getInstance();
        const cameraTrack = localStream.getVideoTracks()[0];
        const sender = pc.getSenders().find(sender => sender.track.kind === "video");
        if (sender) {
            sender.replaceTrack(cameraTrack);
        }

        screenShareBtn.textContent = "Share Screen";
        screenShareBtn.style.backgroundColor = "#4CAF50";
    }
});

endCallBtn.addEventListener("click", (e) => {
    socket.emit("call-ended", caller);
    hideNotification();
});

socket.on("joined", (allusers) => {
    console.log({ allusers });

    const createUserhtml = () => {
        allusersHtml.innerHTML = "";
        for (const user in allusers) {
            const li = document.createElement("li");
            li.textContent = `${user} ${user === username.value ? "(You)" : ""}`;

            if (user !== username.value) {
                const button = document.createElement("button");
                button.classList.add("call-btn");
                button.addEventListener("click", (e) => {
                    startCall(user);
                });

                const img = document.createElement("img");
                img.setAttribute("src", "/js/images/phone.png");
                img.setAttribute("width", 20);

                button.appendChild(img);
                li.appendChild(button);
            }
            allusersHtml.appendChild(li);
        }
    };
    createUserhtml();
});

socket.on("user-assigned", (data) => {
    userId = data.userId;
    console.log(`You are assigned as: ${userId}`);
    document.getElementById("currentUser").textContent = `Logged in as: ${userId}`;

    // Determine remote user
    remoteUser = userId === "User1" ? "User2" : "User1";

    // Auto-call if both users are online

});

socket.on("call-request", ({ from }) => {
    showIncomingCallNotification(from);
});

socket.on("update-contacts", (connectedUsers) => {
    const contactList = document.getElementById("allusers");
    contactList.innerHTML = "";

    Object.keys(connectedUsers).forEach((user) => {
        if (user !== userId) { // Don't show yourself in the list
            const li = document.createElement("li");
            li.textContent = user;

            const callButton = document.createElement("button");
            callButton.textContent = "Call";
            callButton.addEventListener("click", () => startCall(user));

            li.appendChild(callButton);
            contactList.appendChild(li);
        }
    });
});

socket.on("offer", async ({ from, to, offer }) => {
    console.log(`Received WebRTC offer from ${from}`, offer);

    try {
        remoteUser = from;
        pendingOffer = offer

        // Process any pending ICE candidates
        setTimeout(processPendingIceCandidates, 500);
        showIncomingCallNotification(from)
    } catch (error) {
        console.error("Error handling offer:", error);
        // You might want to notify the user that the call failed
    }
});


socket.on("answer", async ({ from, to, answer }) => {
    console.log(`Received WebRTC answer from ${from}`, answer);

    const pc = peerConnection.getInstance();
    if (!pc) {
        console.error("PeerConnection is not initialized!");
        return;
    }

    try {
        console.log("Setting remote description for answer...");
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("WebRTC connection established!");
        
        // Process any pending ICE candidates after a short delay
        // to ensure the remote description is fully applied
        setTimeout(processPendingIceCandidates, 500);
    } catch (error) {
        console.error("Error setting remote description:", error);
    }
});

socket.on("icecandidate", async ({ candidate }) => {
    console.log("Received ICE Candidate:", candidate);

    const pc = peerConnection.getInstance();
    if (!pc.remoteDescription || pc.remoteDescription.type === null) {
        console.warn("ICE candidate received before remote description. Storing for later.");
        pendingIceCandidates.push(candidate);
    } else {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            console.log("ICE candidate added successfully.");
        } catch (error) {
            console.error("Error adding ICE candidate:", error);
        }
    }
});

socket.on("call-accepted", async ({ from, to }) => {
    console.log(`${from} accepted the call. Proceeding with connection...`);
    
    const pc = peerConnection.getInstance();
    console.log("Creating WebRTC offer...");
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    console.log("Sending WebRTC offer to", to);
    socket.emit("offer", { from: userId, to, offer });
});

socket.on("end-call", ({ from, to }) => {
    endCallBtn.classList.remove("d-none");
});

socket.on("call-ended", (caller) => {
    endCall();
    hideNotification();
});

socket.on("call-canceled", ({ from }) => {
    console.log(`Call from ${from} was canceled before you could answer.`);
    
    // Remove any incoming call notifications
    removeNotification(from);

    // Ensure the notification container is hidden if there are no active notifications
    if (notificationContainer.children.length === 0) {
        notificationContainer.style.display = "none";
    }
});

socket.on("missed-call", ({ caller }) => {
    console.log(`Missed call from ${caller}`);
    
    // Play a missed call sound (optional)
    // const missedCallSound = new Audio('/js/sounds/missed-call.mp3');
    // missedCallSound.play().catch(e => console.log("Missed call sound play failed:", e));

    removeNotification(caller);
    
    // Show missed call notification
    showMissedCallNotification(caller);
});

socket.on("call-rejected", ({ from, to }) => {
    hideCallingNotification();
    alert(`Your call to ${to} was rejected`);
    endCall();
   
    removeNotification()
});

const proceedWithCall = async (from) => {
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            localVideo.srcObject = localStream;
        } catch (error) {
            console.error("Error accessing media devices:", error);
            return;
        }
    }

    remoteUser = from;
    const pc = peerConnection.getInstance();
    const offer = await pc.createOffer();
    console.log({ offer });
    await pc.setLocalDescription(offer);
    socket.emit("offer", { from: assignedUser, to: remoteUser, offer: pc.localDescription });

    clearMissedCallNotification(from)
};

const processPendingIceCandidates = async () => {
    const pc = peerConnection.getInstance();
    console.log(`Processing ${pendingIceCandidates.length} pending ICE candidates`);
    
    while (pendingIceCandidates.length > 0) {
        const candidate = pendingIceCandidates.shift();
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            console.log("Stored ICE candidate added successfully");
        } catch (error) {
            console.error("Error adding stored ICE candidate:", error);
        }
    }

    const results = await Promise.allSettled(promises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    console.log(`Successfully added ${successCount} of ${pendingIceCandidates.length} ICE candidates`);
    
    // Clear the array
    pendingIceCandidates.length = 0;
};

const showMissedCallNotification = (caller) => {
    const notificationElement = document.createElement('div');
    notificationElement.className = 'notification-box missed-call';
    notificationElement.innerHTML = `
        <div style="margin-bottom: 10px;"><strong>${caller}</strong> tried to call you</div>
        <div class="call-btn-container">
            <button class="close-btn">Close</button>
        </div>
    `;

    const closeButton = notificationElement.querySelector('.close-btn');
    closeButton.addEventListener('click', () => {
        notificationContainer.removeChild(notificationElement);
        if (notificationContainer.children.length === 0) {
            notificationContainer.style.display = "none";
        }
    });

    notificationContainer.appendChild(notificationElement);
    notificationContainer.style.display = "block";
};

const rejectCall = (from) => {
    socket.emit("call-rejected", { from: from, to: username.value });
    removeNotification(from);
    clearMissedCallNotification(from)
};

const endCall = () => {
    const pc = peerConnection.getInstance();
    if (pc) {
        pc.close();
        peerConnection.reset();
        endCallBtn.classList.add("d-none");
    }

    if (remoteUser) {
        socket.emit("call-canceled", { from: username.value, to: remoteUser });
    }

    // Reset UI elements
    endCallBtn.classList.add("d-none");
    hideNotification();
    remoteVideo.srcObject = null;

    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    screenShareBtn.textContent = "Share Screen";
    screenShareBtn.style.backgroundColor = "#4CAF50";

    clearMissedCallNotification(remoteUser)

    if(remoteUser){
        clearMissedCallNotification(remoteUser)
    }
};

const clearMissedCallNotification = (caller) => {
    // Find and remove any missed call notifications for this caller
    const missedCallNotifications = Array.from(notificationContainer.querySelectorAll('.notification-box.missed-call'));
    
    missedCallNotifications.forEach(notification => {
        const callerName = notification.querySelector('strong')?.textContent;
        if (callerName === caller) {
            notificationContainer.removeChild(notification);
        }
    });
    
    // Hide container if empty
    if (notificationContainer.children.length === 0) {
        notificationContainer.style.display = "none";
    }
};

const showIncomingCallNotification = (fromUser) => {
    const notificationContainer = document.getElementById("notification-container");
    notificationContainer.innerHTML = `
        <div class="notification-box">
            <div>${fromUser} is calling you</div>
            <button class="accept-call">Accept</button>
            <button class="reject-call">Reject</button>
        </div>
    `;

    notificationContainer.style.display = "block";

    document.querySelector(".accept-call").addEventListener("click", () => acceptCall(fromUser));
    document.querySelector(".reject-call").addEventListener("click", () => rejectIncomingCall (fromUser));
};

const acceptCall = async (fromUser) => {
    remoteUser = fromUser;
    socket.emit("call-accepted", { from: fromUser, to: userId });
    document.getElementById("notification-container").style.display = "none";

    peerConnection.reset();
    const pc = peerConnection.getInstance(); // Get the WebRTC connection

    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
        } catch (error) {
            console.error("Error accessing camera/microphone:", error);
            return;
        }
    }

    // const offer = await pc.createOffer();
    if (pendingOffer) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("answer", { from: userId, to: fromUser, answer });
            pendingOffer = null; // Clear the stored offer
        } catch (error) {
            console.error("Error handling offer:", error);
        }
    }
};

const rejectIncomingCall  = (fromUser) => {
    socket.emit("call-rejected", { from: fromUser, to: userId });
    document.getElementById("notification-container").style.display = "none";
};

const showCallingNotification = (callee) => {
    notificationContainer.innerHTML = `
        <div class="notification-box">
            <div class="calling-info">Calling <strong>${callee}</strong>...</div>
            <div class="call-btn-container">
                <button id="cancel-call" class="reject-btn">Cancel</button>
            </div>
        </div>
    `;

    notificationContainer.style.display = "block";

    document.getElementById("cancel-call").addEventListener("click", () => {
        socket.emit("call-rejected", { from: username.value, to: callee });
        hideCallingNotification();
        endCall();
    });

    document.getElementById("cancel-call").addEventListener("click", () => {
        socket.emit("call-canceled", { from: username.value, to: callee });
        hideCallingNotification();
        endCall();
    });
    
    callingNotificationTimeout = setTimeout(() => {
        hideCallingNotification();
    }, 10000);
};

const hideCallingNotification = () => {
    clearTimeout(callingNotificationTimeout);
    notificationContainer.innerHTML = '';
    notificationContainer.style.display = "none";
};

const removeNotification = (caller) => {
    if (pendingCalls.has(caller)) {
        const element = pendingCalls.get(caller);
        if (element.audio) {
            element.audio.pause();
        }
        notificationContainer.removeChild(element);
        pendingCalls.delete(caller);

        if (notificationContainer.children.length === 0) {
            notificationContainer.style.display = "none";
        }
    }
};

const hideNotification = () => {
    pendingCalls.forEach((element, caller) => {
        if (element.audio) {
            element.audio.pause();
        }
    });
    pendingCalls.clear();

    notificationContainer.innerHTML = '';
    notificationContainer.style.display = "none";
};

const startMyVideo = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        console.log({ stream });
        localStream = stream;
        localVideo.srcObject = stream;
        cameraToggle.src = "/js/images/camera-on.png"; // Set initial image to "camera on"
        isCameraOn = true;
        audioToggle.src = "/js/images/mic-on.png"; // Set initial image to "mic on"
        isAudioOn = true;
    } catch (error) {
        console.log("error in startMyVideo", error);
    }
};


const startCall = async (toUserId) => {
    console.log(`Calling ${toUserId}...`);
    remoteUser = toUserId;
    socket.emit("call-request", { from: userId, to: toUserId });

    const pc = peerConnection.getInstance(); // Get the WebRTC connection

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { from: userId, to: remoteUser, offer });
};

// Start video
startMyVideo();