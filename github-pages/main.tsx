import React from "react";
import { createRoot } from "react-dom/client";
import ExpenseTracker from "../app/expense-tracker";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ExpenseTracker />
  </React.StrictMode>,
);
