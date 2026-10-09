import {
  CroissantIcon,
  GemIcon,
  HammerIcon,
  type LucideIcon,
  PillIcon,
  SettingsIcon,
  ShirtIcon,
  ShoppingBasketIcon,
  SmartphoneIcon,
  StoreIcon,
  TvIcon,
  UtensilsIcon,
  WarehouseIcon,
  WrenchIcon,
} from 'lucide-react';
import type { BusinessType } from '@shopdesk/shared';

export const BUSINESS_ICONS: Record<BusinessType, LucideIcon> = {
  supermarket: ShoppingBasketIcon,
  pharmacy: PillIcon,
  jewellery: GemIcon,
  mobile: SmartphoneIcon,
  electronics: TvIcon,
  clothing: ShirtIcon,
  hardware: HammerIcon,
  bakery: CroissantIcon,
  restaurant: UtensilsIcon,
  general: StoreIcon,
  wholesale: WarehouseIcon,
  service: WrenchIcon,
  custom: SettingsIcon,
};
