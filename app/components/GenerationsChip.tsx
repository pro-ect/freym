import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Zap } from 'lucide-react-native';
import { useBalance } from '../../contexts/BalanceContext';
import GlassPill from './GlassPill';

const ACCENT = '#FF2D95';

type Props = {
  onPress?: () => void;
};

export default function GenerationsChip({ onPress }: Props) {
  const { balanceInfo, hasCustomKey } = useBalance();

  const primary = hasCustomKey
    ? '∞'
    : balanceInfo.isLoading
    ? '…'
    : String(balanceInfo.rawValue);

  return (
    <GlassPill onPress={onPress}>
      <Zap size={15} color={ACCENT} strokeWidth={2.5} fill={ACCENT} />
      <Text style={styles.primary}>{primary}</Text>
    </GlassPill>
  );
}

const styles = StyleSheet.create({
  primary: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: -0.2,
  },
});
