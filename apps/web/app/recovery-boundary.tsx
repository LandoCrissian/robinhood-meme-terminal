"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type RecoveryBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  name: string;
};

type RecoveryBoundaryState = {
  failed: boolean;
};

export class RecoveryBoundary extends Component<RecoveryBoundaryProps, RecoveryBoundaryState> {
  state: RecoveryBoundaryState = { failed: false };

  static getDerivedStateFromError(): RecoveryBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the report free of wallet, profile, route, and transaction data.
    console.error(`[RMT:${this.props.name}] isolated client failure`, {
      error: error.name,
      component: info.componentStack?.split("\n").find(Boolean)?.trim() ?? "unknown"
    });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
