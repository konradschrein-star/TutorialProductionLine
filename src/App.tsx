import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { RecordingUploadQueue } from './components/RecordingUploadQueue';
import { CreatorWizard } from './pages/CreatorWizard';
import { ThumbnailStudio } from './pages/ThumbnailStudio';
import { KeywordHub } from './pages/KeywordHub';
import { FinishedVideos } from './pages/FinishedVideos';
import { Settings } from './pages/Settings';
import { StorageService } from './services/storageService';
import { Channel, VAUser } from './types';

export const App: React.FC = () => {
  const [activeChannel, setActiveChannel] = useState<Channel>(() => StorageService.getActiveChannel());
  const [activeUser, setActiveUser] = useState<VAUser>(() => StorageService.getActiveUser());

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col selection:bg-accent-purple selection:text-white bg-grid">
      
      {/* Top Navigation */}
      <Navbar
        activeChannel={activeChannel}
        onChannelChange={setActiveChannel}
        activeUser={activeUser}
        onUserChange={setActiveUser}
      />

      {/* Main Routed Content */}
      <main className="flex-1 pb-16">
        <Routes>
          <Route path="/" element={<CreatorWizard activeChannel={activeChannel} activeUser={activeUser} />} />
          <Route path="/thumbnails" element={<ThumbnailStudio />} />
          <Route path="/keywords" element={<KeywordHub activeChannel={activeChannel} />} />
          <Route path="/finished" element={<FinishedVideos />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* Floating Resumable Background Upload Queue */}
      <RecordingUploadQueue />

    </div>
  );
};
