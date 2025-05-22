import { Routes, Route } from "react-router-dom";
import { VideoChat } from "./pages";

function App() {
  return (
    <>
      <Routes>
        <Route path="/video" element={<VideoChat />} />
        {/* Add more routes as needed */}
      </Routes>
    </>
  );
}

export default App;
