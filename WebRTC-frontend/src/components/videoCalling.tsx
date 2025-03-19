import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Box, 
  Typography, 
  List, 
  ListItem,
  ListItemButton,
  ListItemText, 
  Button, 
  Paper, 
  Container, 
  Grid, 
  Avatar, 
  IconButton, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions,
  Snackbar,
  Alert,
  Chip
} from '@mui/material';
import { 
  Call as CallIcon, 
  CallEnd as CallEndIcon, 
  Mic as MicIcon, 
  MicOff as MicOffIcon, 
  Videocam as VideocamIcon, 
  VideocamOff as VideocamOffIcon,
  Person as PersonIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon
} from '@mui/icons-material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

declare global {
    interface Window {
      pendingAutoAnswer?: string;
    }
  }

// Type definitions
interface User {
  id: string;
  name: string;
}

interface CallRequest {
  from: string;
  to: string;
}

interface WebRTCOffer extends CallRequest {
  offer: RTCSessionDescriptionInit;
}

interface WebRTCAnswer extends CallRequest {
  answer: RTCSessionDescriptionInit;
}

interface IceCandidate extends CallRequest {
  candidate: RTCIceCandidateInit;
}

// Create a theme
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#3f51b5',
    },
    secondary: {
      main: '#f50057',
    },
    background: {
      default: '#f5f5f5',
      paper: '#ffffff',
    },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#f48fb1',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
});

const VideoCallingApp: React.FC = () => {
  // State variables
  const [userId, setUserId] = useState<string>('');
  const [users, setUsers] = useState<Record<string, any>>({});
  const [remoteUser, setRemoteUser] = useState<string | null>(null);
  const [isCallInProgress, setIsCallInProgress] = useState<boolean>(false);
  const [notification, setNotification] = useState<{
    type: 'incoming' | 'outgoing' | 'missed' | null;
    user: string | null;
  }>({ type: null, user: null });
  const [isAudioOn, setIsAudioOn] = useState<boolean>(true);
  const [isCameraOn, setIsCameraOn] = useState<boolean>(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [incomingCallUser, setIncomingCallUser] = useState<string | null>(null);

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);

  // Initialize socket connection
  useEffect(() => {
    socketRef.current = io('http://localhost:8000');

    // Socket event listeners
    socketRef.current.on('joined', (allUsers: Record<string, any>) => {
      console.log({ allUsers });
      setUsers(allUsers);
    });

    socketRef.current.on('user-assigned', (data: { userId: string }) => {
      setUserId(data.userId);
      console.log(`You are assigned as: ${data.userId}`);
      
      // Determine remote user
      const remoteUserName = data.userId === "User1" ? "User2" : "User1";
      setRemoteUser(remoteUserName);
    });

    socketRef.current.on('call-request', ({ from }: CallRequest) => {
      setNotification({ type: 'incoming', user: from });
      setIncomingCallUser(from);
    });

    socketRef.current.on('update-contacts', (connectedUsers: Record<string, any>) => {
      setUsers(connectedUsers);
    });

    socketRef.current.on('offer', async ({ from, to, offer }: WebRTCOffer) => {
      console.log(`Received WebRTC offer from ${from}`, offer);
      
      try {
        setRemoteUser(from);
        pendingOfferRef.current = offer;
        
        // Process any pending ICE candidates
        setTimeout(processPendingIceCandidates, 500);
        setNotification({ type: 'incoming', user: from });
      } catch (error) {
        console.error("Error handling offer:", error);
      }
    });

    socketRef.current.on('answer', async ({ from, answer }: WebRTCAnswer) => {
      console.log(`Received WebRTC answer from ${from}`, answer);
      
      if (!peerConnectionRef.current) {
        console.error("PeerConnection is not initialized!");
        return;
      }
      
      try {
        console.log("Setting remote description for answer...");
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("WebRTC connection established!");
        
        // Process any pending ICE candidates after a short delay
        setTimeout(processPendingIceCandidates, 500);
      } catch (error) {
        console.error("Error setting remote description:", error);
      }
    });

    socketRef.current.on('icecandidate', async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      console.log("Received ICE Candidate:", candidate);
      
      if (!peerConnectionRef.current?.remoteDescription) {
        console.warn("ICE candidate received before remote description. Storing for later.");
        pendingIceCandidatesRef.current.push(candidate);
      } else {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          console.log("ICE candidate added successfully.");
        } catch (error) {
          console.error("Error adding ICE candidate:", error);
        }
      }
    });

    socketRef.current.on('call-accepted', async ({ from, to }: CallRequest) => {
      console.log(`${from} accepted the call. Proceeding with connection...`);
      setIsCallInProgress(true);
      setNotification({ type: null, user: null });
      
      if (!peerConnectionRef.current) {
        createPeerConnection();
      }
      
      console.log("Creating WebRTC offer...");
      
      try {
        const offer = await peerConnectionRef.current?.createOffer();
        await peerConnectionRef.current?.setLocalDescription(offer);
        
        console.log("Sending WebRTC offer to", to);
        socketRef.current?.emit("offer", { from: userId, to, offer });
      } catch (error) {
        console.error("Error creating or sending offer:", error);
      }
    });

    socketRef.current.on('call-ended', (caller: any) => {
      endCall();
      setNotification({ type: null, user: null });
    });

    socketRef.current.on('call-canceled', ({ from }: { from: string }) => {
      console.log(`Call from ${from} was canceled before you could answer.`);
      setNotification({ type: null, user: null });
    });

    socketRef.current.on('missed-call', ({ caller }: { caller: string }) => {
      console.log(`Missed call from ${caller}`);
      setNotification({ type: 'missed', user: caller });
    });

    socketRef.current.on('call-rejected', ({ from, to }: CallRequest) => {
      setNotification({ type: null, user: null });
      alert(`Your call to ${to} was rejected`);
      endCall();
    });

    socketRef.current.on('media-state-change', ({ from, mediaType, enabled }) => {
      console.log(`Remote user ${from} ${mediaType} state changed to ${enabled ? 'enabled' : 'disabled'}`);
      
      // If the remote video was turned back on, we may need to refresh the connection
      if (mediaType === 'video' && enabled && remoteVideoRef.current) {
        // Force a refresh of the remote video element
        const currentStream = remoteVideoRef.current.srcObject;
        if (currentStream) {
          remoteVideoRef.current.srcObject = null;
          setTimeout(() => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = currentStream;
            }
          }, 100);
        }
      }
    });

    // Check URL parameters for notification actions
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const callerParam = urlParams.get('caller');
    
    if (action === 'answer' && callerParam) {
      console.log('Auto-answering call from:', callerParam);
      // Will be handled once the user is logged in
      window.pendingAutoAnswer = callerParam;
    }

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  // Initialize local media stream
  useEffect(() => {
    startMyVideo();
  }, []);

  // Function to create a PeerConnection
  const createPeerConnection = () : RTCPeerConnection => {
    const config = {
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        }
      ]
    };
    
    peerConnectionRef.current = new RTCPeerConnection(config);
    
    if (localStreamRef.current) {
      // Check if tracks are already added
      const senders = peerConnectionRef.current.getSenders();
      const trackKinds = senders.map(sender => sender.track?.kind);
      
      localStreamRef.current.getTracks().forEach(track => {
        // Only add the track if a sender with this track kind doesn't exist
        if (!trackKinds.includes(track.kind)) {
          console.log("Adding local track:", track.kind);
          peerConnectionRef.current?.addTrack(track, localStreamRef.current!);
        } else {
          console.log("Track already exists. Skipping addTrack for:", track.kind);
        }
      });
    }
    
    peerConnectionRef.current.ontrack = function (event) {
      console.log("Track received:", event.track.kind, "- active:", event.track.enabled);
      console.log("Stream has tracks:", event.streams[0]?.getTracks().map(t => t.kind));
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
        console.log("Set remote video source to stream");
      }
    };
    
    peerConnectionRef.current.onicecandidate = function (event) {
      if (event.candidate && socketRef.current) {
        console.log("Sending ICE candidate:", event.candidate);
        socketRef.current.emit("icecandidate", { candidate: event.candidate, to: remoteUser });
      }
    };
    
    // Add connection state change handlers for debugging
    peerConnectionRef.current.oniceconnectionstatechange = () => {
      console.log("ICE Connection State:", peerConnectionRef.current?.iceConnectionState);
    };
    
    peerConnectionRef.current.onconnectionstatechange = () => {
      console.log("Connection State:", peerConnectionRef.current?.connectionState);
      if (peerConnectionRef.current?.connectionState === 'connected') {
        console.log("WebRTC connection established successfully!");
      }
    };
    
    peerConnectionRef.current.onsignalingstatechange = () => {
      console.log("Signaling State:", peerConnectionRef.current?.signalingState);
    };
    
    return peerConnectionRef.current;
  };

  // Function to process pending ICE candidates
  const processPendingIceCandidates = async () => {
    if (!peerConnectionRef.current) return;
    
    console.log(`Processing ${pendingIceCandidatesRef.current.length} pending ICE candidates`);
    
    const promises = pendingIceCandidatesRef.current.map(async (candidate) => {
      try {
        await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Stored ICE candidate added successfully");
        return true;
      } catch (error) {
        console.error("Error adding stored ICE candidate:", error);
        return false;
      }
    });
    
    const results = await Promise.allSettled(promises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    console.log(`Successfully added ${successCount} of ${pendingIceCandidatesRef.current.length} ICE candidates`);
    
    // Clear the array
    pendingIceCandidatesRef.current = [];
  };

  // Function to start local video
  const startMyVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      console.log({ stream });
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      setIsCameraOn(true);
      setIsAudioOn(true);
    } catch (error) {
      console.log("error in startMyVideo", error);
    }
  };

  // Function to toggle audio
  const toggleAudio = () => {
    if (!localStreamRef.current) return;
    
    const newState = !isAudioOn;
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = newState;
    });
    
    setIsAudioOn(newState);
    
    // Notify the other user about audio state
    if (socketRef.current && remoteUser && isCallInProgress) {
      socketRef.current.emit("media-state-change", { 
        from: userId, 
        to: remoteUser, 
        mediaType: 'audio',
        enabled: newState 
      });
    }
  };

  // Function to toggle camera
  const toggleCamera = async () => {
    if (isCameraOn) {
      // Turn off the camera
      localStreamRef.current?.getVideoTracks().forEach(track => track.stop());
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      setIsCameraOn(false);
      
      // Notify the other user about camera state
      if (socketRef.current && remoteUser && isCallInProgress) {
        socketRef.current.emit("media-state-change", { 
          from: userId, 
          to: remoteUser, 
          mediaType: 'video',
          enabled: false 
        });
      }
    } else {
      // Turn on the camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: isAudioOn });
        
        // Replace audio tracks if they exist
        if (localStreamRef.current) {
          const audioTracks = localStreamRef.current.getAudioTracks();
          if (audioTracks.length > 0) {
            stream.getAudioTracks().forEach(track => track.enabled = isAudioOn);
          }
        }
        
        localStreamRef.current = stream;
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        setIsCameraOn(true);
        
        // Replace the video track in the peer connection if it exists
        if (peerConnectionRef.current && isCallInProgress) {
          const videoTrack = stream.getVideoTracks()[0];
          const senders = peerConnectionRef.current.getSenders();
          const videoSender = senders.find(sender => 
            sender.track && sender.track.kind === 'video'
          );
          
          if (videoSender) {
            await videoSender.replaceTrack(videoTrack);
          } else {
            peerConnectionRef.current.addTrack(videoTrack, stream);
          }
          
          // Notify the other user about camera state
          if (socketRef.current && remoteUser) {
            socketRef.current.emit("media-state-change", { 
              from: userId, 
              to: remoteUser, 
              mediaType: 'video',
              enabled: true 
            });
          }
        }
      } catch (error) {
        console.error("Error accessing camera:", error);
      }
    }
  };

  // Function to start a call
  const startCall = async (toUserId: string) => {
    console.log(`Starting call to ${toUserId}`);
    setRemoteUser(toUserId);
    setNotification({ type: 'outgoing', user: toUserId });
    
    if (socketRef.current) {
      socketRef.current.emit("call-request", { from: userId, to: toUserId });
    }
    
    // Create peer connection for outgoing call
    if (!peerConnectionRef.current) {
      createPeerConnection();
    }
    
    try {
      const offer = await peerConnectionRef.current?.createOffer();
      await peerConnectionRef.current?.setLocalDescription(offer);
      
      if (socketRef.current) {
        socketRef.current.emit("offer", { from: userId, to: toUserId, offer });
      }
    } catch (error) {
      console.error("Error creating or sending offer:", error);
    }
  };

  // Function to accept an incoming call
  const acceptCall = async (fromUser: string) => {
    console.log(`Accepting call from ${fromUser}`);
    
    // Update UI state
    setIsCallInProgress(true);
    setRemoteUser(fromUser);
    setNotification({ type: null, user: null });
    setIncomingCallUser(null);
    
    if (socketRef.current) {
      socketRef.current.emit("call-accepted", { from: fromUser, to: userId });
    }
    
    // Reset and create new peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Create a new peer connection and store the reference
    const peerConnection = createPeerConnection();
    
    if (!localStreamRef.current) {
        try {
          localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
        } catch (error) {
          console.error("Error accessing camera/microphone:", error);
          return;
        }
    }
    
    if (pendingOfferRef.current && peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        if (socketRef.current) {
          socketRef.current.emit("answer", { from: userId, to: fromUser, answer });
        }

        pendingOfferRef.current = null; // Clear the stored offer
      } catch (error) {
        console.error("Error handling offer:", error);
      }
    }
  };  

  // Function to end the call
  const endCall = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteUser && socketRef.current) {
      socketRef.current.emit("call-ended", { from: userId, to: remoteUser });
    }

    // Reset UI elements
    setIsCallInProgress(false);
    setRemoteUser(null);
    setNotification({ type: null, user: null });
    setIncomingCallUser(null);

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  // Function to reject an incoming call
  const rejectCall = (fromUser: string) => {
    if (socketRef.current) {
      socketRef.current.emit("call-rejected", { from: fromUser, to: userId });
    }
    setNotification({ type: null, user: null });
    setIncomingCallUser(null);
  };

  // Add theme toggle function
  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Render the component
  return (
    <ThemeProvider theme={isDarkMode ? darkTheme : theme}>
      <Box sx={{ 
        bgcolor: 'background.default',
        minHeight: '100vh',
        position: 'relative'
      }}>
        {/* Video Section - Full Screen */}
        <Box 
          sx={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            bgcolor: isDarkMode ? '#000' : '#1a1a1a',
            zIndex: 0
          }}
        >
          {/* Remote Video (Main) */}
          <Box 
            sx={{ 
              width: '100%', 
              height: '100%', 
              position: 'relative',
              bgcolor: '#000000',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              muted={false}
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'cover',
                display: isCallInProgress ? 'block' : 'none',
                filter: isDarkMode ? 'brightness(0.9)' : 'none'
              }} 
              onLoadedMetadata={(e) => {
                console.log("Remote video metadata loaded");
                e.currentTarget.play().catch(err => console.error("Error playing remote video:", err));
              }}
            />
            
            {!isCallInProgress && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center',
                  gap: 2
                }}
              >
                <PersonIcon sx={{ fontSize: 80, color: 'text.secondary' }} />
                <Typography variant="h4" color="text.secondary">
                  No active call
                </Typography>
              </Box>
            )}
          </Box>
          
          {/* Local Video (Picture-in-Picture) */}
          <Box 
            sx={{ 
              position: 'fixed', 
              bottom: 32, 
              right: 10, 
              width: 280, 
              height: 180, 
              borderRadius: 2,
              overflow: 'hidden',
              border: '3px solid',
              borderColor: 'primary.main',
              bgcolor: isCameraOn ? 'transparent' : 'background.paper',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              transition: 'all 0.3s ease',
              '&:hover': {
                transform: 'scale(1.05)',
                boxShadow: '0 6px 24px rgba(0,0,0,0.5)'
              }
            }}
          >
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              playsInline 
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'contain',
                display: isCameraOn ? 'block' : 'none'
              }} 
            />
            
            {!isCameraOn && (
              <Box 
                sx={{ 
                  display: 'flex', 
                  flexDirection: 'column',
                  justifyContent: 'center', 
                  alignItems: 'center', 
                  height: '100%',
                  gap: 1
                }}
              >
                <VideocamOffIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                <Typography variant="body1" color="text.secondary">
                  Camera Off
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* Controls and UI Overlay */}
        <Box 
          sx={{ 
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1,
            background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
            padding: '20px 0'
          }}
        >
          {/* Call Controls */}
          <Box 
            sx={{ 
              display: 'flex', 
              justifyContent: 'center', 
              gap: 4,
              mb: 2
            }}
          >
            <IconButton 
              onClick={toggleAudio} 
              color={isAudioOn ? 'primary' : 'error'}
              sx={{ 
                width: 64,
                height: 64,
                bgcolor: isAudioOn ? 'primary.light' : 'error.light',
                color: isAudioOn ? 'primary.contrastText' : 'error.contrastText',
                '&:hover': {
                  bgcolor: isAudioOn ? 'primary.main' : 'error.main',
                  transform: 'scale(1.1)',
                  transition: 'all 0.2s ease'
                }
              }}
            >
              {isAudioOn ? <MicIcon sx={{ fontSize: 32 }} /> : <MicOffIcon sx={{ fontSize: 32 }} />}
            </IconButton>
            
            <IconButton 
              onClick={toggleCamera} 
              color={isCameraOn ? 'primary' : 'error'}
              sx={{ 
                width: 64,
                height: 64,
                bgcolor: isCameraOn ? 'primary.light' : 'error.light',
                color: isCameraOn ? 'primary.contrastText' : 'error.contrastText',
                '&:hover': {
                  bgcolor: isCameraOn ? 'primary.main' : 'error.main',
                  transform: 'scale(1.1)',
                  transition: 'all 0.2s ease'
                }
              }}
            >
              {isCameraOn ? <VideocamIcon sx={{ fontSize: 32 }} /> : <VideocamOffIcon sx={{ fontSize: 32 }} />}
            </IconButton>
            
            <IconButton 
              onClick={endCall} 
              disabled={!isCallInProgress}
              sx={{ 
                width: 64,
                height: 64,
                bgcolor: 'error.main',
                color: 'error.contrastText',
                '&:hover': {
                  bgcolor: 'error.dark',
                  transform: 'scale(1.1)',
                  transition: 'all 0.2s ease'
                },
                '&.Mui-disabled': {
                  bgcolor: 'action.disabledBackground',
                  color: 'action.disabled'
                }
              }}
            >
              <CallEndIcon sx={{ fontSize: 32 }} />
            </IconButton>
          </Box>
        </Box>

        {/* User List Drawer */}
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            height: '100vh',
            width: '300px',
            bgcolor: 'background.paper',
            boxShadow: '4px 0 20px rgba(0,0,0,0.2)',
            zIndex: 2,
            overflowY: 'auto',
            transition: 'transform 0.3s ease',
            transform: 'translateX(0)'
          }}
        >
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography 
                variant="h6" 
                sx={{ 
                  color: 'primary.main',
                  fontWeight: 'bold'
                }}
              >
                Online Users
              </Typography>
              <IconButton onClick={toggleTheme} color="primary">
                {isDarkMode ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Box>
            <List>
              {Object.keys(users).map((user) => (
                <ListItemButton
                  key={user}
                  component="div"
                  disabled={user === userId || (isCallInProgress && incomingCallUser !== user)}
                  sx={{ 
                    borderRadius: 2,
                    mb: 1,
                    bgcolor: user === userId ? 'primary.light' : (incomingCallUser === user ? 'rgba(255, 152, 0, 0.1)' : 'transparent'),
                    color: user === userId ? 'primary.contrastText' : 'text.primary',
                    cursor: 'default',
                    '&:hover': {
                      bgcolor: user === userId ? 'primary.main' : (incomingCallUser === user ? 'rgba(255, 152, 0, 0.15)' : 'rgba(0, 0, 0, 0.04)'),
                    },
                    '&.Mui-disabled': {
                      opacity: 0.7,
                      bgcolor: user === userId ? 'primary.light' : 'transparent'
                    }
                  }}
                >
                  <Avatar 
                    sx={{ 
                      mr: 2, 
                      bgcolor: user === userId ? 'primary.main' : (incomingCallUser === user ? 'warning.main' : 'secondary.main'),
                      width: 40,
                      height: 40
                    }}
                  >
                    {user.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography
                      sx={{
                        fontWeight: 'bold',
                        color: user === userId ? '#ffffff' : (isDarkMode ? '#ffffff' : '#000000'),
                        fontSize: '1rem',
                        letterSpacing: '0.01em'
                      }}
                    >
                      {user}
                    </Typography>
                    <Typography
                      sx={{
                        color: user === userId ? 'rgba(255, 255, 255, 0.9)' : (isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)'),
                        fontWeight: 'medium',
                        fontSize: '0.875rem'
                      }}
                    >
                      {user === userId ? 'You' : (incomingCallUser === user ? 'Calling you...' : 'Available')}
                    </Typography>
                  </Box>
                  
                  {/* Call Button for available users */}
                  {user !== userId && !isCallInProgress && incomingCallUser !== user && (
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={<CallIcon />}
                      onClick={(e) => {
                        e.stopPropagation();
                        startCall(user);
                      }}
                      sx={{
                        borderRadius: 8,
                        px: 2,
                        py: 1,
                        textTransform: 'none',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 8px rgba(63, 81, 181, 0.2)',
                        '&:hover': {
                          boxShadow: '0 6px 12px rgba(63, 81, 181, 0.3)',
                          transform: 'translateY(-2px)',
                          transition: 'all 0.2s ease'
                        }
                      }}
                    >
                      Call
                    </Button>
                  )}
                  
                  {/* Accept/Reject Buttons for incoming call */}
                  {incomingCallUser === user && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="contained"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          rejectCall(user);
                        }}
                        sx={{
                          minWidth: '40px',
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          p: 0,
                          boxShadow: '0 4px 8px rgba(244, 67, 54, 0.2)',
                          '&:hover': {
                            boxShadow: '0 6px 12px rgba(244, 67, 54, 0.3)'
                          }
                        }}
                      >
                        <CallEndIcon />
                      </Button>
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          acceptCall(user);
                        }}
                        sx={{
                          minWidth: '40px',
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          p: 0,
                          boxShadow: '0 4px 8px rgba(63, 81, 181, 0.2)',
                          '&:hover': {
                            boxShadow: '0 6px 12px rgba(63, 81, 181, 0.3)'
                          }
                        }}
                      >
                        <CallIcon />
                      </Button>
                    </Box>
                  )}
                </ListItemButton>
              ))}
            </List>
          </Box>
        </Box>

        {/* Missed Call Notification */}
        <Snackbar 
          open={notification.type === 'missed'} 
          autoHideDuration={6000} 
          onClose={() => setNotification({ type: null, user: null })}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          <Alert 
            severity="info" 
            variant="filled"
            onClose={() => setNotification({ type: null, user: null })}
            sx={{ width: '100%' }}
          >
            Missed call from {notification.user}
          </Alert>
        </Snackbar>
        
        {/* Outgoing Call Dialog */}
        <Dialog 
          open={notification.type === 'outgoing'} 
          onClose={endCall}
          PaperProps={{
            sx: {
              borderRadius: 2,
              minWidth: 300
            }
          }}
        >
          <DialogTitle sx={{ textAlign: 'center' }}>
            Calling...
          </DialogTitle>
          <DialogContent sx={{ textAlign: 'center', py: 2 }}>
            <Avatar sx={{ width: 60, height: 60, mx: 'auto', mb: 2, bgcolor: 'secondary.main' }}>
              {notification.user?.charAt(0).toUpperCase()}
            </Avatar>
            <Typography variant="h6" gutterBottom>
              {notification.user}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Waiting for answer...
            </Typography>
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'center', pb: 3 }}>
            <Button 
              variant="contained" 
              color="error" 
              onClick={endCall}
              startIcon={<CallEndIcon />}
            >
              Cancel
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
};

export default VideoCallingApp;