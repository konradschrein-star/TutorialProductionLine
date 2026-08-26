import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Navbar } from './components/Navbar';
import { RecordingUploadQueue } from './components/RecordingUploadQueue';
import { SetupWizardModal } from './components/SetupWizardModal';
import { LocalizationModal } from './components/LocalizationModal';
import { CreatorWizard } from './pages/CreatorWizard';
import { StudioPipeline } from './pages/StudioPipeline';
import { ThumbnailStudio } from './pages/ThumbnailStudio';
import { KeywordHub } from './pages/KeywordHub';
import { MetricsDashboard } from './pages/MetricsDashboard';
import { FinishedVideos } from './pages/FinishedVideos';
import { Settings } from './pages/Settings';
import { Guide } from './pages/Guide';
import { StorageService } from './services/storageService';
import { Channel, VAUser } from './types';

export const App: React.FC = () => {
  const [activeChannel, setActiveChannel] = useState<Channel>(() => StorageService.getActiveChannel());
  const [activeUser, setActiveUser] = useState<VAUser>(() => StorageService.getActiveUser());
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState<boolean>(false);
  const [isLocalizationOpen, setIsLocalizationOpen] = useState<boolean>(false);

  // Check if first-time onboarding is completed
  useEffect(() => {
    const onboarding = StorageService.getOnboardingState();
    if (!onboarding.isCompleted) {
      setIsSetupWizardOpen(true);
    }
  }, []);

  const handleCompleteSetup = (newChannel: Channel, newUser: VAUser) => {
    setActiveChannel(newChannel);
    setActiveUser(newUser);
  };

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div className="min-h-screen bg-background text-foreground flex flex-col font-sans transition-colors duration-150">
          
          {/* Top Workstation Navigation */}
          <Navbar
            activeChannel={activeChannel}
            onChannelChange={setActiveChannel}
            activeUser={activeUser}
            onUserChange={setActiveUser}
            onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
            onOpenLocalization={() => setIsLocalizationOpen(true)}
          />

          {/* Workspace Canvas Area */}
          <main className="flex-1 pb-16">
            <Routes>
              <Route path="/" element={<CreatorWizard activeChannel={activeChannel} activeUser={activeUser} />} />
              <Route path="/studio" element={<StudioPipeline />} />
              <Route path="/thumbnails" element={<ThumbnailStudio />} />
              <Route path="/keywords" element={<KeywordHub activeChannel={activeChannel} />} />
              <Route path="/metrics" element={<MetricsDashboard />} />
              <Route path="/finished" element={<FinishedVideos />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/guide" element={<Guide />} />
            </Routes>
          </main>

          {/* Floating Background Upload Dispatcher */}
          <RecordingUploadQueue />

          {/* Guided Onboarding Wizard Modal */}
          <SetupWizardModal
            isOpen={isSetupWizardOpen}
            onClose={() => setIsSetupWizardOpen(false)}
            onComplete={handleCompleteSetup}
          />

          {/* Multi-Language Video Localization Factory */}
          <LocalizationModal
            isOpen={isLocalizationOpen}
            onClose={() => setIsLocalizationOpen(false)}
            topic={activeChannel.niche ? `${activeChannel.niche} Tutorial` : 'Software Walkthrough'}
            originalScript={`Welcome to this tutorial for ${activeChannel.name}. In this guide we cover the essentials step-by-step.`}
            channelName={activeChannel.name}
          />

        </div>
      </ThemeProvider>
    </ErrorBoundary>
  );
};
