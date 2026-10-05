import { registerEnokiWallets } from "@mysten/enoki";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import "@mysten/dapp-kit/dist/index.css";

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl("testnet") },
});

/**
 * Google is an Enoki zkLogin wallet in the same list as Slush. Without the
 * public Enoki key and Google client id, only Slush (and any installed
 * Wallet Standard extension) appears.
 */
function EnokiRegistrar({ children }: { children: ReactNode }) {
  useState(() => {
    const apiKey = import.meta.env.VITE_ENOKI_API_KEY;
    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!apiKey || !googleClientId || typeof window === "undefined") return;
    registerEnokiWallets({
      apiKey,
      network: "testnet",
      client: new SuiClient({ url: getFullnodeUrl("testnet") }),
      providers: {
        google: {
          clientId: googleClientId,
          redirectUrl: window.location.origin,
        },
      },
    });
  });
  return children;
}

export default function WalletProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <EnokiRegistrar>
          <WalletProvider autoConnect slushWallet={{ name: "Bew Harness" }}>
            {children}
          </WalletProvider>
        </EnokiRegistrar>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
