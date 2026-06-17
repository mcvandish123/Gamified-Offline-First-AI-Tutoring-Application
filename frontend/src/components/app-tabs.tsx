import { NativeTabs, Label, Icon } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const schemeName = scheme === 'dark' ? 'dark' : 'light';
  const colors = Colors[schemeName];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <Label>Home</Label>
        <Icon
          src={require('@/assets/images/tabIcons/home.png')}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <Label>Explore</Label>
        <Icon
          src={require('@/assets/images/tabIcons/explore.png')}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
