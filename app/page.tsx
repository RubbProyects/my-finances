import AuthGate from "@/components/AuthGate";
import AppNavigation from "@/components/AppNavigation";

export default function Home() {
  return (
    <AuthGate>
      <AppNavigation />
    </AuthGate>
  );
}
