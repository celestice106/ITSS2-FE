import React, { useRef, useState, useEffect } from "react";
import io from "socket.io-client";

const SOCKET_URL = "http://localhost:3001"; // Change to your backend socket URL

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

  // Room state
  const [showForm, setShowForm] = useState(true);
  const [roomId, setRoomId] = useState("");
  const [isCreator, setIsCreator] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");

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
  const handleUserInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // You should generate or fetch a userId here, for demo we'll use name+timestamp
    setUserId(`${userInfo.name}_${Date.now()}`);
    setInfoSubmitted(true);
  };

  // 2. Room create/join form submit
  const handleRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let res, data;
    if (isCreator) {
      res = await fetch("/api/createRoom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      data = await res.json();
      setRoomId(data.videosession_id);
    } else {
      res = await fetch(`/api/joinRoom/${joinRoomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      data = await res.json();
      setRoomId(data.videosession_id);
    }
    setShowForm(false);
  };

  // 3. Setup socket and WebRTC after roomId is set
  useEffect(() => {
    if (!roomId) return;

    socketRef.current = io(SOCKET_URL);

    socketRef.current.emit("join-room", roomId);

    socketRef.current.on("user-joined", async () => {
      if (isCreator) {
        const offer = await peerRef.current!.createOffer();
        await peerRef.current!.setLocalDescription(offer);
        socketRef.current.emit("offer", { room: roomId, sdp: offer });
      }
    });

    socketRef.current.on("offer", async (data: any) => {
      await peerRef.current!.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await peerRef.current!.createAnswer();
      await peerRef.current!.setLocalDescription(answer);
      socketRef.current.emit("answer", { room: roomId, sdp: answer });
    });

    socketRef.current.on("answer", async (data: any) => {
      await peerRef.current!.setRemoteDescription(new RTCSessionDescription(data.sdp));
    });

    socketRef.current.on("ice-candidate", async (data: any) => {
      try {
        await peerRef.current!.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {}
    });

    peerRef.current = new RTCPeerConnection();
    peerRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", { room: roomId, candidate: event.candidate });
      }
    };
    peerRef.current.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach((track) => peerRef.current!.addTrack(track, stream));
    });

    return () => {
      socketRef.current.disconnect();
      peerRef.current?.close();
    };
    // eslint-disable-next-line
  }, [roomId, isCreator]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Draggable handlers for local video
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDragging(true);
    setOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    if (!dragPos) {
      setDragPos({
        x: rect.left,
        y: rect.top,
      });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (dragging) {
      setDragPos({
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
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
      ) : showForm ? (
        <form className="flex flex-col space-y-4 bg-white p-6 rounded-lg shadow-lg min-w-[320px]" onSubmit={handleRoomSubmit}>
          <div className="flex space-x-2">
            <button
              type="button"
              className={`py-2 px-4 rounded ${isCreator ? "bg-pink-500 text-white" : "bg-gray-200"}`}
              onClick={() => setIsCreator(true)}
            >
              Create Room
            </button>
            <button
              type="button"
              className={`py-2 px-4 rounded ${!isCreator ? "bg-pink-500 text-white" : "bg-gray-200"}`}
              onClick={() => setIsCreator(false)}
            >
              Join Room
            </button>
          </div>
          {!isCreator && (
            <input
              type="text"
              placeholder="Room ID"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              required
              className="border px-4 py-2 rounded"
            />
          )}
          <button type="submit" className="bg-pink-400 text-white py-2 rounded">
            {isCreator ? "Create & Join" : "Join"}
          </button>
        </form>
      ) : (
        <div className="relative flex items-center justify-center w-full h-[70vh]">
          {/* Big remote video */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="block rounded-lg bg-black w-2/3 h-full object-cover"
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
      )}
    </div>
  );
};