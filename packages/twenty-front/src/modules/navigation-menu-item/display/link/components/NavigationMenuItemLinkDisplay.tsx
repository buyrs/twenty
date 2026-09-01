import { useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { IconArrowUpRight } from 'twenty-ui/icon';
import { ThemeContext, themeCssVariables } from 'twenty-ui/theme-constants';

import { isLayoutCustomizationModeEnabledState } from '@/layout-customization/states/isLayoutCustomizationModeEnabledState';
import { NavigationMenuItemIcon } from '@/navigation-menu-item/display/components/NavigationMenuItemIcon';
import { getLinkNavigationMenuItemComputedLink } from '@/navigation-menu-item/display/link/utils/getLinkNavigationMenuItemComputedLink';
import { getLinkNavigationMenuItemLabel } from '@/navigation-menu-item/display/link/utils/getLinkNavigationMenuItemLabel';
import type { NavigationMenuItemSectionContentProps } from '@/navigation-menu-item/display/sections/types/NavigationMenuItemSectionContentProps';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

type NavigationMenuItemLinkDisplayProps = NavigationMenuItemSectionContentProps;

export const NavigationMenuItemLinkDisplay = ({
  item,
  editModeProps,
  isDragging,
  rightOptions,
}: NavigationMenuItemLinkDisplayProps) => {
  const isLayoutCustomizationModeEnabled = useAtomStateValue(
    isLayoutCustomizationModeEnabledState,
  );
  const { theme } = useContext(ThemeContext);
  const location = useLocation();

  const label = getLinkNavigationMenuItemLabel(item);
  const computedLink = getLinkNavigationMenuItemComputedLink(item);
  const isExternalLink =
    computedLink.startsWith('http://') || computedLink.startsWith('https://');
  const isActive =
    computedLink !== '' &&
    !isExternalLink &&
    location.pathname === computedLink;

  const defaultRightOptions =
    !isLayoutCustomizationModeEnabled && isExternalLink ? (
      <IconArrowUpRight
        size={theme.icon.size.sm}
        stroke={theme.icon.stroke.md}
        color={themeCssVariables.font.color.light}
      />
    ) : undefined;

  return (
    <NavigationDrawerItem
      label={label}
      to={
        isLayoutCustomizationModeEnabled || isDragging
          ? undefined
          : computedLink
      }
      onClick={
        isLayoutCustomizationModeEnabled
          ? editModeProps?.onEditModeClick
          : undefined
      }
      Icon={() => <NavigationMenuItemIcon navigationMenuItem={item} />}
      active={isActive}
      isSelectedInEditMode={editModeProps?.isSelectedInEditMode}
      isDragging={isDragging}
      triggerEvent="CLICK"
      rightOptions={rightOptions ?? defaultRightOptions}
    />
  );
};
