import { gql } from '@apollo/client';

export const GET_MY_FOLLOW_UP_SETTINGS = gql`
  query MyFollowUpSettings {
    myFollowUpSettings {
      thresholdDays
      digestEnabled
    }
  }
`;
