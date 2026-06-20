import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from './logo';

import Constants from 'expo-constants';

const getBackendUrl = () => {
  if (Platform.OS === 'web') {
    return 'http://localhost:3000';
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    return `http://${hostIp}:3000`;
  }
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
};

const BACKEND_URL = getBackendUrl();

interface SignUpScreenProps {
  onSignUpSuccess?: () => void;
  onBackToLogin?: () => void;
}

export default function SignUpScreen({ onSignUpSuccess, onBackToLogin }: SignUpScreenProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Focus states
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);

  // API states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    if (!username || !email || !password || !confirmPassword) {
      setErrorMessage('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed. Please try again.');
      }

      setSuccessMessage('Registration successful! Redirecting to login...');
      setTimeout(() => {
        if (onSignUpSuccess) {
          onSignUpSuccess();
        }
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error. Could not connect to backend.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Card Wrapper */}
          <View style={styles.card}>
            {/* Logo Header */}
            <View style={styles.logoContainer}>
              <Logo style={styles.logoImage} />
            </View>

            {/* Welcome Text */}
            <View style={styles.welcomeContainer}>
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Sign up to start your research.</Text>
            </View>

            {/* Feedback Messages */}
            {errorMessage && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {successMessage && (
              <View style={styles.successContainer}>
                <Text style={styles.successText}>{successMessage}</Text>
              </View>
            )}

            {/* Form Fields */}
            <View style={styles.formContainer}>
              {/* Username Field */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  style={[
                    styles.input,
                    usernameFocused && styles.inputFocused,
                  ]}
                  placeholder="your_username"
                  placeholderTextColor="#A0A0B0"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  onFocus={() => setUsernameFocused(true)}
                  onBlur={() => setUsernameFocused(false)}
                />
              </View>

              {/* Email Field */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={[
                    styles.input,
                    emailFocused && styles.inputFocused,
                  ]}
                  placeholder="name@university.edu"
                  placeholderTextColor="#A0A0B0"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                />
              </View>

              {/* Password Field */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={[
                    styles.input,
                    passwordFocused && styles.inputFocused,
                  ]}
                  placeholder="••••••••"
                  placeholderTextColor="#A0A0B0"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
              </View>

              {/* Confirm Password Field */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput
                  style={[
                    styles.input,
                    confirmPasswordFocused && styles.inputFocused,
                  ]}
                  placeholder="••••••••"
                  placeholderTextColor="#A0A0B0"
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onFocus={() => setConfirmPasswordFocused(true)}
                  onBlur={() => setConfirmPasswordFocused(false)}
                />
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.signUpButton, isLoading && styles.signUpButtonDisabled]}
                onPress={handleSignUp}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.signUpButtonText}>Sign Up</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Footer (outside card) */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={onBackToLogin}>
              <Text style={styles.signInLinkText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 24,
    justifyContent: 'center',
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 16,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)',
        borderWidth: 1,
        borderColor: '#E2E8F0',
      },
    }),
  },
  logoContainer: {
    marginBottom: 48,
    width: '100%',
    alignItems: 'flex-start',
  },
  logoImage: {
    width: 150,
    height: 44,
  },
  welcomeContainer: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#606060',
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '500',
  },
  successContainer: {
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  successText: {
    color: '#059669',
    fontSize: 14,
    fontWeight: '500',
  },
  formContainer: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1A1A1A',
    backgroundColor: '#F8FAFC',
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      },
    }),
  },
  inputFocused: {
    borderColor: '#6B9E1E',
    borderWidth: 1.5,
  },
  signUpButton: {
    backgroundColor: '#6B9E1E',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  signUpButtonDisabled: {
    backgroundColor: '#A3D160',
  },
  signUpButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
  },
  footerText: {
    fontSize: 14,
    color: '#64748B',
  },
  signInLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B9E1E',
  },
});
