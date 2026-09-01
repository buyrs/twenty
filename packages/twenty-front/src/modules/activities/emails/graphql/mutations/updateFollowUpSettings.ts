import { gql } from '@apollo/client';

export const UPDATE_FOLLOW_UP_SETTINGS = gql`
  mutation UpdateFollowUpSettings(
    $thresholdDays: Float
    $nudgeEnabled: Boolean
    $nudgeIntervalDays: Float
    $digestEnabled: Boolean
  ) {
    updateFollowUpSettings(
      thresholdDays: $thresholdDays
      nudgeEnabled: $nudgeEnabled
      nudgeIntervalDays: $nudgeIntervalDays
      digestEnabled: $digestEnabled
    ) {
      thresholdDays
      nudgeEnabled
      nudgeIntervalDays
      digestEnabled
    }
  }
`;
