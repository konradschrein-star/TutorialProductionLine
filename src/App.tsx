import React, { useState, useEffect } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { RoleProvider, useRole, Permission } from './context/RoleContext';
import { FeedbackProvider } from './components/ui/Feedback';
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
import { AdminConfig } from './pages/AdminConfig';
import { Guide } from './pages/Guide';
import { StorageService } from './services/storageService';
import { useConfig, useActiveChannel, useActiveUser } from './hooks/useStore';

/** Applies UI-configurable branding (accent color + product name) as global side-effects. */
const ApplyConfig: React.FC = () => {
  const config = useConfig();
  useEffect(() => {
    if (config.brandAccent) {
      document.documentElement.style.setProperty('--accent', config.brandAccent);
    }
    document.title = `${config.productName || 'Tutorial Studio'} — Production Suite`;
  }, [config.brandAccent, config.productName]);
  return null;
};

/** Route guard: renders children only if the active user holds `perm`. */
const RequirePerm: React.FC<{ perm: Permission; children: React.ReactNode }> = ({ perm, children }) => {
  const { can, role } = useRole();
  if (can(perm)) return <>{children}</>;
  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center animate-fadeIn">
      <div className="pro-panel rounded-xl p-8">
        <h1 className="text-lg font-semibold text-foreground">Restricted area</h1>
        <p className="text-sm text-muted mt-2">
          Your role (<span className="badge badge-neutral uppercase">{role}</span>) doesn't have access to this
          section. Ask an administrator if you need it.
        </p>
        <Link to="/" className="btn-accent inline-block mt-5 rounded-md px-4 py-2 text-sm focus-ring">
          Back to production
        </Link>
      </div>
    </div>
  );
};

const NotFound: React.FC = () => (
  <div className="max-w-lg mx-auto px-4 py-20 text-center animate-fadeIn">
    <div className="pro-panel rounded-xl p-8">
      <p className="font-mono text-3xl font-bold text-muted">404</p>
      <h1 className="text-lg font-semibold text-foreground mt-2">Page not found</h1>
      <Link to="/" className="btn-accent inline-block mt-5 rounded-md px-4 py-2 text-sm focus-ring">
        Back to production
      </Link>
    </div>
  </div>
);

const AppShell: React.FC = () => {
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState<boolean>(false);
  const [isLocalizationOpen, setIsLocalizationOpen] = useState<boolean>(false);
  const activeChannel = useActiveChannel();
  const activeUser = useActiveUser();

  useEffect(() => {
    const onboarding = StorageService.getOnboardingState();
    if (!onboarding.isCompleted) setIsSetupWizardOpen(true);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans transition-colors duration-150">
      <ApplyConfig />
      <Navbar
        onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
        onOpenLocalization={() => setIsLocalizationOpen(true)}
      />

      <main className="flex-1 pb-16">
        <Routes>
          <Route path="/" element={<CreatorWizard activeChannel={activeChannel} activeUser={activeUser} />} />
          <Route path="/studio" element={<RequirePerm perm="produce"><StudioPipeline /></RequirePerm>} />
          <Route
            path="/thumbnails"
            element={<RequirePerm perm="thumbnails"><ThumbnailStudio /></RequirePerm>}
          />
          <Route path="/keywords" element={<KeywordHub activeChannel={activeChannel} />} />
          <Route
            path="/metrics"
            element={<RequirePerm perm="viewOwnMetrics"><MetricsDashboard /></RequirePerm>}
          />
          <Route path="/finished" element={<RequirePerm perm="produce"><FinishedVideos /></RequirePerm>} />
          <Route path="/config" element={<RequirePerm perm="manageConfig"><AdminConfig /></RequirePerm>} />
          <Route path="/settings" element={<RequirePerm perm="manageChannels"><Settings /></RequirePerm>} />
          <Route path="/guide" element={<Guide />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <RecordingUploadQueue />

      <SetupWizardModal
        isOpen={isSetupWizardOpen}
        onClose={() => setIsSetupWizardOpen(false)}
        onComplete={() => setIsSetupWizardOpen(false)}
      />
      <LocalizationModal
        isOpen={isLocalizationOpen}
        onClose={() => setIsLocalizationOpen(false)}
        topic={activeChannel.niche ? `${activeChannel.niche} Tutorial` : 'Software Walkthrough'}
        originalScript={`Welcome to this tutorial for ${activeChannel.name}. In this guide we cover the essentials step-by-step.`}
        channelName={activeChannel.name}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <RoleProvider>
          <FeedbackProvider>
            <AppShell />
          </FeedbackProvider>
        </RoleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};
