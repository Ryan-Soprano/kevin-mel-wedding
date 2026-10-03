import { createRoot } from "react-dom/client";
import ContractPreview from "./PreviewApp.jsx";

// Separate Vite development entry. The wedding app never imports this preview.
if (import.meta.env.DEV) createRoot(document.getElementById("root")).render(<ContractPreview />);
