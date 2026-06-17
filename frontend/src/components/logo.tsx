import React from 'react';
import { Image } from 'expo-image';

interface LogoProps {
  style?: any;
}

export function Logo({ style }: LogoProps) {
  return (
    <Image
      source={require('../../assets/logo/logo.svg')}
      style={style}
      contentFit="contain"
    />
  );
}
