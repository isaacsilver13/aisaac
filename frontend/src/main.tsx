import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "@fontsource-variable/inter";
import "./theme/theme.css";
import "./styles.css";
import { motionDuration, motionEase } from "./theme/motion";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: motionDuration.standard, ease: motionEase }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);
