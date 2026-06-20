import React, { useState } from 'react'
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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Logo } from './logo'
import { saveAccessToken } from '../../db/auth-storage'

import Constants from 'expo-constants'

const getBackendUrl = () => {
  if (Platform.OS === 'web') {
    return 'http://localhost:3000'
  }
  const hostUri = Constants.expoConfig?.hostUri
  if (hostUri) {
    const hostIp = hostUri.split(':')[0]
    return `http://${hostIp}:3000`
  }
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:3000'
    : 'http://localhost:3000'
}

const BACKEND_URL = getBackendUrl()

interface LoginScreenProps {
  onLoginSuccess?: () => void
  onSignUpPress?: () => void
}

export default function LoginScreen({
  onLoginSuccess,
  onSignUpPress,
}: LoginScreenProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailFocused, setEmailFocused] = useState(false)
  const [passwordFocused, setPasswordFocused] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSignIn = async () => {
    if (!email || !password) {
      setErrorMessage('Please fill in all fields')
      return
    }

    setIsLoading(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const response = await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.message || 'Login failed. Please check your credentials.',
        )
      }

      setSuccessMessage('Login successful! Redirecting...')

      await saveAccessToken(data.session.access_token)

      setTimeout(() => {
        if (onLoginSuccess) {
          onLoginSuccess()
        } else {
          router.replace('/')
        }
      }, 1500)
    } catch (err: any) {
      setErrorMessage(
        err.message || 'Network error. Could not connect to backend.',
      )
    } finally {
      setIsLoading(false)
    }
  }

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
          <View style={styles.card}>
            <View style={styles.logoContainer}>
              <Logo style={styles.logoImage} />
            </View>

            <View style={styles.welcomeContainer}>
              <Text style={styles.title}>Welcome Back</Text>
              <Text style={styles.subtitle}>
                Sign in to continue your research.
              </Text>
            </View>

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

            <View style={styles.formContainer}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={[styles.input, emailFocused && styles.inputFocused]}
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

              <View style={styles.inputGroup}>
                <View style={styles.passwordLabelContainer}>
                  <Text style={styles.label}>Password</Text>
                  <TouchableOpacity
                    onPress={() => console.log('Forgot password')}
                  >
                    <Text style={styles.forgotPasswordText}>
                      Forgot Password?
                    </Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, passwordFocused && styles.inputFocused]}
                  placeholder="••••••••"
                  placeholderTextColor="#A0A0B0"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
              </View>

              <TouchableOpacity
                style={[
                  styles.signInButton,
                  isLoading && styles.signInButtonDisabled,
                ]}
                onPress={handleSignIn}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.signInButtonText}>Sign In</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={onSignUpPress}>
              <Text style={styles.signUpText}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
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
  passwordLabelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  forgotPasswordText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B9E1E',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1A1A1A',
    backgroundColor: '#FFFFFF',
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
  signInButton: {
    backgroundColor: '#6B9E1E',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  signInButtonDisabled: {
    backgroundColor: '#A3D160',
  },
  signInButtonText: {
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
  signUpText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B9E1E',
  },
})
