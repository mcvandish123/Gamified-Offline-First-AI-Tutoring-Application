import { useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import LoginScreen from '@/components/login';
import SignUpScreen from '@/components/signup';

export default function TabLayout() {
  console.log('AppTabs:', AppTabs);
  console.log('AnimatedSplashOverlay:', AnimatedSplashOverlay);
  console.log('LoginScreen:', LoginScreen);
  const colorScheme = useColorScheme();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {isAuthenticated ? (
        <AppTabs />
      ) : isSigningUp ? (
        <SignUpScreen 
          onSignUpSuccess={() => setIsSigningUp(false)} 
          onBackToLogin={() => setIsSigningUp(false)} 
        />
      ) : (
        <LoginScreen 
          onLoginSuccess={() => setIsAuthenticated(true)} 
          onSignUpPress={() => setIsSigningUp(true)}
        />
      )}
    </ThemeProvider>
  );
}
