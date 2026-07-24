import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { ENTITLEMENTS } from '../../lib/revenuecat';

interface RCPaywallModalProps {
  visible: boolean;
  onClose: () => void;
  onPurchaseComplete?: () => void;
}

export default function RCPaywallModal({
  visible,
  onClose,
  onPurchaseComplete,
}: RCPaywallModalProps) {
  const handleResult = (result: PAYWALL_RESULT) => {
    if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
      onPurchaseComplete?.();
      return;
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <RevenueCatUI.Paywall
          options={{
            displayCloseButton: true,
          }}
          onPurchaseCompleted={() => {
            onPurchaseComplete?.();
          }}
          onPurchaseError={() => {
            // Surface stays open; user can retry or dismiss
          }}
          onRestoreCompleted={({ customerInfo }) => {
            if (customerInfo.entitlements.active[ENTITLEMENTS.SUBSCRIPTION]) {
              onPurchaseComplete?.();
            }
          }}
          onDismiss={onClose}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
