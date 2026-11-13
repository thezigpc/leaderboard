import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { basePath, ErrorBoundary, VenueAnnouncement } from "@bargames/gamekit/client";
import { AdminPage } from "./pages/AdminPage";
import { HostPage } from "./pages/HostPage";
import { PhoneBoard, PhoneHome } from "./pages/PhonePage";
import { TvPage } from "./pages/TvPage";
import { useVenue } from "./useVenue";
import "./index.css";

/**
 * Bar Games: keeps the venue theme applied, and shows the staff's announcement at the top of
 * the phone pages. The TV view renders its own (VenueAnnouncement hides itself where it
 * doesn't belong, following the staff's choice of phones or TVs). Off a box: nothing.
 */
function Venue() {
  const venue = useVenue();
  const { pathname } = useLocation();
  if (pathname === "/tv" || pathname.startsWith("/tv/")) return null;
  return <VenueAnnouncement ctx={venue} />;
}

const onTv = () => {
  const base = basePath();
  const p = base && location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
  return p.replace(/\/+$/, "") === "/tv";
};

function CrashScreen({ reload }: { reload: () => void }) {
  // A TV can't press a button: try again on its own.
  if (onTv()) {
    setTimeout(() => location.reload(), 10_000);
    return <div className="tv" />;
  }
  return (
    <div className="pad center">
      <h1>Something broke</h1>
      <p className="muted">Reloading usually fixes it.</p>
      <button className="primary" onClick={reload}>
        Reload
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(_e, reload) => <CrashScreen reload={reload} />}>
      {/* basePath(): "/leaderboard" under a path prefix, "" at the root. */}
      <BrowserRouter basename={basePath()}>
        <Venue />
        <Routes>
          <Route path="/" element={<PhoneHome />} />
          <Route path="/b/:id" element={<PhoneBoard />} />
          <Route path="/tv" element={<TvPage />} />
          <Route path="/host" element={<HostPage />} />
          <Route path="/host/:id" element={<HostPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
