/**
 * Replicate Account Balance Utilities
 * Fetches account information from Replicate API
 */

export interface ReplicateAccountInfo {
  username: string;
  balance: number; // in USD
  credit_balance: number; // in credits
}

/**
 * Fetch account information from Replicate API
 * @param apiKey - User's Replicate API key
 * @returns Account information or null if error
 */
export async function fetchReplicateAccountBalance(apiKey: string): Promise<ReplicateAccountInfo | null> {
  try {
    const response = await fetch('https://api.replicate.com/v1/account', {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch Replicate account:', response.status);
      return null;
    }

    const data = await response.json();

    return {
      username: data.username || 'Unknown',
      balance: data.balance || 0,
      credit_balance: data.credit_balance || 0,
    };
  } catch (error) {
    console.error('Error fetching Replicate account:', error);
    return null;
  }
}

/**
 * Format balance for display
 * @param balance - Balance in USD
 * @returns Formatted string like "$5.42" or "$0.00"
 */
export function formatBalance(balance: number): string {
  return `$${balance.toFixed(2)}`;
}
