import React from 'react';
import RoleDashboardScreen from '../shared/RoleDashboardScreen';
import ParentProfileScreen from './ParentProfileScreen';

export default function ParentHomeScreen() {
  return (
    <RoleDashboardScreen title="Parent" subtitle="Support learner progress, interventions, and milestones." fillAvailableHeight>
      <ParentProfileScreen />
    </RoleDashboardScreen>
  );
}
