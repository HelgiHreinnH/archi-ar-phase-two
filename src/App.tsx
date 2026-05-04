import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import ProtectedRoute from "./components/ProtectedRoute";

// Phase 3.1 — Route-level code-splitting. The public AR viewer at /view/:shareId
// is the most performance-critical route — keeping dashboard, wizard, settings,
// etc. out of its initial bundle is the biggest single win here.
const LandingPage = lazy(() => import("./pages/LandingPage"));
const ARViewer = lazy(() => import("./pages/ARViewer"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Auth = lazy(() => import("./pages/Auth"));
const DashboardLayout = lazy(() => import("./components/DashboardLayout"));
const DashboardHome = lazy(() => import("./pages/DashboardHome"));
const ProjectsList = lazy(() => import("./pages/ProjectsList"));
const NewProject = lazy(() => import("./pages/NewProject"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const HowItWorksPage = lazy(() => import("./pages/HowItWorksPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/view/:shareId" element={<ARViewer />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/auth" element={<Auth />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardHome />} />
              {/* Support both old and new routes */}
              <Route path="projects" element={<Navigate to="/dashboard/experiences" replace />} />
              <Route path="projects/new" element={<Navigate to="/dashboard/experiences/new" replace />} />
              <Route path="projects/:id" element={<ProjectDetail />} />
              <Route path="experiences" element={<ProjectsList />} />
              <Route path="experiences/new" element={<NewProject />} />
              <Route path="experiences/:id" element={<ProjectDetail />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="how-it-works" element={<HowItWorksPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
