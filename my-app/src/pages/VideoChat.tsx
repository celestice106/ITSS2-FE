import React, { useRef, useState, useEffect } from "react";
import io from "socket.io-client";

const SOCKET_URL = "https://itss2-75f6.onrender.com"; 


export const VideoChat = () => {
  // User info state
  const [userInfo, setUserInfo] = useState({
    name: "",
    age: "",
    sex: "",
    level: "",
  });
  const [userId, setUserId] = useState(""); // This could be generated or fetched after user info submit
  const [infoSubmitted, setInfoSubmitted] = useState(false);

  // New: Language and topic form state
  const [showExtraForm, setShowExtraForm] = useState(false);
  const [languages, setLanguages] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);

  // Room state
  const [sessionId, setSessionId] = useState("");

  // Video/WebRTC state
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const socketRef = useRef<any>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);

  // Draggable state for local video
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // 1. User info form submit
  const handleUserInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Only send username to backend, backend will generate user_id
    try {
      const res = await fetch("https://itss2-75f6.onrender.com/users/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userInfo.name }),
      });
      if (!res.ok) {
        throw new Error("Failed to register user");
      }
      const data = await res.json();
      setUserId(data.user_id); // user_id returned from backend
      setInfoSubmitted(true);
      setShowExtraForm(true); // Show extra form after info is submitted
      console.log("User registered with ID:", data.user_id);
    } catch (err) {
      console.error("User registration failed:", err);
      alert("Failed to register user info. Please try again.");
    }
  };

  // New: Extra form submit handler
  const handleExtraFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Prepare data
    const languageStr = languages.join(",");
    const topicStr = topics.join(",");
    try {
      const res = await fetch("https://itss2-75f6.onrender.com/match-or-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          language: languageStr,
          topic: topicStr,
          level: userInfo.level,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to match or join");
      }
      console.log("Match or join successful:", data);
      console.log(topicStr);
      setSessionId(data.session_id);
      setShowExtraForm(false);
      // Optionally: show a message if waiting for match
    } catch (err) {
      alert("Failed to match or join: " + err);
    }
  };

  // 3. Setup socket and WebRTC after roomId is set
  useEffect(() => {
    if (!sessionId) return;

    let localStream: MediaStream;

    const setup = async () => {
      // 1. Create peer connection
      peerRef.current = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" }
        ]
      });

      // 2. Get local media and add tracks BEFORE signaling
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 }, // or 1920 for Full HD
          height: { ideal: 1080 }, // or 1080 for Full HD
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000, // Opus default, high quality
          channelCount: 2    // Stereo
        }
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
      localStream.getTracks().forEach((track) => peerRef.current!.addTrack(track, localStream));
      const videoSender = peerRef.current.getSenders().find(
        s => s.track && s.track.kind === "video"
      );
      if (videoSender && videoSender.setParameters) {
        const params = videoSender.getParameters();
        if (!params.encodings) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = 2500000; // 2.5 Mbps for HD video
        videoSender.setParameters(params);
      }
      // 3. Set up peer connection event handlers
      peerRef.current.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit("ice-candidate", { room: sessionId, candidate: event.candidate });
        }
      };
      peerRef.current.ontrack = (event) => {
        console.log("Received remote stream:", event.streams[0]);
        setRemoteStream(event.streams[0]);
      };

      // 4. Connect to signaling server
      socketRef.current = io(SOCKET_URL);
      socketRef.current.on("connect", () => {
        console.log("Connected to signaling server with socket id:", socketRef.current.id);
      });

      // 5. Join the signaling room
      socketRef.current.emit("join-room", sessionId);

      // 6. Set up socket event listeners
      socketRef.current.on("user-joined", async () => {
        const offer = await peerRef.current!.createOffer();
        await peerRef.current!.setLocalDescription(offer);
        socketRef.current.emit("offer", { room: sessionId, sdp: offer });
        console.log("A user joined the room");
      });

      // --- THIS IS THE IMPORTANT PART FOR THE JOINER ---
      socketRef.current.on("offer", async (data: any) => {
        // At this point, local tracks are already added!
        console.log("Offer received from another user:", data);
        await peerRef.current!.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peerRef.current!.createAnswer();
        await peerRef.current!.setLocalDescription(answer);
        socketRef.current.emit("answer", { room: sessionId, sdp: answer });
        console.log("Received offer");
      });

      socketRef.current.on("answer", async (data: any) => {
        await peerRef.current!.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log("Received answer");
      });

      socketRef.current.on("ice-candidate", async (data: any) => {
        try {
          await peerRef.current!.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log("Received ICE candidate");
        } catch (e) { }
      });
    };

    setup();

    // Cleanup
    return () => {
      socketRef.current?.disconnect();
      peerRef.current?.close();
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
    // eslint-disable-next-line
  }, [sessionId]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      console.log("Remote stream set on video element");
    }
  }, [remoteStream]);
  const containerRef = useRef<HTMLDivElement>(null);
  // Draggable handlers for local video
  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    const videoRect = (e.target as HTMLElement).getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      setOffset({
        x: e.clientX - videoRect.left,
        y: e.clientY - videoRect.top,
      });
      // Set initial dragPos if not set
      if (!dragPos) {
        setDragPos({
          x: videoRect.left - containerRect.left,
          y: videoRect.top - containerRect.top,
        });
      }
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (dragging && containerRef.current && localVideoRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const videoRect = localVideoRef.current.getBoundingClientRect();

      // Calculate new position
      let newX = e.clientX - containerRect.left - offset.x;
      let newY = e.clientY - containerRect.top - offset.y;

      // Clamp to container bounds
      const maxX = containerRect.width - videoRect.width;
      const maxY = containerRect.height - videoRect.height;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      setDragPos({
        x: newX,
        y: newY,
      });
    }
  };

  const handleMouseUp = () => setDragging(false);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    } else {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    // eslint-disable-next-line
  }, [dragging, offset]);

  // Checkbox handlers for extra form
  const handleLanguageChange = (lang: string) => {
    setLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  };
  const handleTopicChange = (topic: string) => {
    setTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-r from-pink-400 to-red-400">
      {!infoSubmitted ? (
        <form
          className="flex flex-col space-y-4 bg-white p-6 rounded-lg shadow-lg min-w-[320px]"
          onSubmit={handleUserInfoSubmit}
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={userInfo.name}
              onChange={(e) => setUserInfo({ ...userInfo, name: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
            <input
              type="number"
              value={userInfo.age}
              onChange={(e) => setUserInfo({ ...userInfo, age: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sex</label>
            <select
              value={userInfo.sex}
              onChange={(e) => setUserInfo({ ...userInfo, sex: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-md"
            >
              <option value="" disabled>
                Select sex
              </option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Level</label>
            <select
              value={userInfo.level}
              onChange={(e) => setUserInfo({ ...userInfo, level: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-md"
            >
              <option value="" disabled>
                Select level
              </option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advance">Advance</option>
              <option value="expert">Expert</option>
            </select>
          </div>
          <button type="submit" className="bg-pink-400 text-white py-2 rounded">
            Continue
          </button>
        </form>
      ) : showExtraForm ? (
        // Extra form for languages and topics
        <form
          className="flex flex-col space-y-4 bg-white p-6 rounded-lg shadow-lg min-w-[320px]"
          onSubmit={handleExtraFormSubmit}
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Languages you want to practice:
            </label>
            <div className="flex space-x-4">
              <label>
                <input
                  type="checkbox"
                  checked={languages.includes("English")}
                  onChange={() => handleLanguageChange("English")}
                  className="mr-1"
                />
                English
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={languages.includes("Japanese")}
                  onChange={() => handleLanguageChange("Japanese")}
                  className="mr-1"
                />
                Japanese
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Topics you are interested in:
            </label>
            <div className="flex flex-wrap gap-4">
              {["Sports", "Science", "Country", "Music", "Movies", "Work", "Technology"].map((topic) => (
                <label key={topic}>
                  <input
                    type="checkbox"
                    checked={topics.includes(topic)}
                    onChange={() => handleTopicChange(topic)}
                    className="mr-1"
                  />
                  {topic}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" className="bg-pink-400 text-white py-2 rounded">
            Continue
          </button>
        </form>
      ) : sessionId ? (
        // Video call layout (show video UI)
        <div className="flex items-center justify-center w-full h-[70vh]">
          <div className="relative w-2/3 h-full" ref={containerRef}>
            {/* Big remote video */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="block rounded-lg bg-black w-full h-full object-cover"
            />
            {/* Small local video, draggable */}
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              onMouseDown={handleMouseDown}
              className={
                "absolute w-1/4 rounded-lg shadow-lg border-2 border-white bg-gray-300 object-cover cursor-move select-none" +
                (dragPos ? "" : " top-4 right-4")
              }
              style={dragPos ? { left: dragPos.x, top: dragPos.y } : undefined}
            />
          </div>
        </div>
      ) : (
        // Optional: show a loading or waiting message
        <div className="text-white text-xl">Waiting for a match...</div>
      )}
    </div>
  );
};