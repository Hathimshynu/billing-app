import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const;

export interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
  /** Prevent closing by clicking outside (e.g. while saving). */
  dismissible?: boolean;
}

/** A dialog on desktop and a bottom sheet on phones (thumb-friendly, never a cramped modal). */
export function ResponsiveDialog({ open, onOpenChange, title, description, children, footer, size = 'md', className, dismissible = true }: ResponsiveDialogProps) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={dismissible}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description ? <DrawerDescription>{description}</DrawerDescription> : null}
          </DrawerHeader>
          <div className={cn('overflow-y-auto px-4 pb-2', className)}>{children}</div>
          {footer ? <DrawerFooter className="safe-bottom">{footer}</DrawerFooter> : null}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(SIZES[size], 'max-h-[90dvh] gap-0 overflow-hidden p-0')}
        onInteractOutside={(e) => {
          if (!dismissible) e.preventDefault();
        }}
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className={cn('max-h-[calc(90dvh-9rem)] overflow-y-auto px-5 py-4', className)}>{children}</div>
        {footer ? <DialogFooter className="border-t px-5 py-3">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
