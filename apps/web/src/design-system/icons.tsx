import { forwardRef, useId, type SVGProps } from "react";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { BuildingOfficeIcon } from "@phosphor-icons/react/dist/csr/BuildingOffice";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { FileMagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/FileMagnifyingGlass";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { BookOpenTextIcon } from "@phosphor-icons/react/dist/csr/BookOpenText";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { CloudArrowUpIcon } from "@phosphor-icons/react/dist/csr/CloudArrowUp";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassMinus";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";

/** Licensed source vectors; one regular-weight family, including active states. */
export const iconVectors = {
  objects: FolderSimpleIcon, building: BuildingOfficeIcon, inspection: ShieldCheckIcon,
  review: FileMagnifyingGlassIcon, protocol: ClipboardTextIcon, catalog: BookOpenTextIcon,
  document: FileTextIcon, history: ClockCounterClockwiseIcon,
  "arrow-left": ArrowLeftIcon, "arrow-right": ArrowRightIcon, "arrow-up-right": ArrowUpRightIcon,
  "chevron-right": CaretRightIcon, "chevron-down": CaretDownIcon, menu: ListIcon,
  "panel-collapse": SidebarSimpleIcon, close: XIcon, upload: CloudArrowUpIcon,
  download: DownloadSimpleIcon, search: MagnifyingGlassIcon, filter: FunnelSimpleIcon,
  adjustments: SlidersHorizontalIcon, "zoom-in": MagnifyingGlassPlusIcon,
  "zoom-out": MagnifyingGlassMinusIcon, plus: PlusIcon, check: CheckIcon,
  success: CheckCircleIcon, warning: WarningIcon, error: XCircleIcon,
  loading: SpinnerGapIcon, refresh: ArrowsClockwiseIcon, send: PaperPlaneTiltIcon,
  settings: GearSixIcon, account: UserCircleIcon,
} as const;

export type IconName = keyof typeof iconVectors;
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number | string;
  title?: string;
};

/** Stable semantic adapter: local vector sources, no icon font or remote requests. */
function createIcon(name: IconName) {
  const Vector = iconVectors[name];
  const Icon = forwardRef<SVGSVGElement, IconProps>(function InterfaceIcon(
    { size = 24, title, className = "", ...props }, ref,
  ) {
    const titleId = useId();
    const named = Boolean(title || props["aria-label"] || props["aria-labelledby"]);
    return <Vector
      aria-hidden={named ? undefined : true} role={named ? "img" : undefined}
      aria-labelledby={title ? titleId : undefined} focusable="false"
      {...props} ref={ref} size={size} weight="regular" color="currentColor"
      className={`ui-icon ui-icon--${name} ${className}`.trim()}
    >
      {title && <title id={titleId}>{title}</title>}
    </Vector>;
  });
  Icon.displayName = `InterfaceIcon(${name})`;
  return Icon;
}

export const FolderKanban = createIcon("objects");
export const Building2 = createIcon("building");
export const ShieldCheck = createIcon("inspection");
export const FileSearch = createIcon("review");
export const FileCheck2 = createIcon("protocol");
export const BookOpen = createIcon("catalog");
export const FileText = createIcon("document");
export const FileClock = createIcon("history");
export const ArrowLeft = createIcon("arrow-left");
export const ArrowRight = createIcon("arrow-right");
export const ArrowUpRight = createIcon("arrow-up-right");
export const ChevronRight = createIcon("chevron-right");
export const ChevronDown = createIcon("chevron-down");
export const Menu = createIcon("menu");
export const PanelLeftClose = createIcon("panel-collapse");
export const X = createIcon("close");
export const UploadCloud = createIcon("upload");
export const Download = createIcon("download");
export const Search = createIcon("search");
export const Filter = createIcon("filter");
export const SlidersHorizontal = createIcon("adjustments");
export const ZoomIn = createIcon("zoom-in");
export const ZoomOut = createIcon("zoom-out");
export const Plus = createIcon("plus");
export const Check = createIcon("check");
export const CheckCircle2 = createIcon("success");
export const AlertTriangle = createIcon("warning");
export const XCircle = createIcon("error");
export const LoaderCircle = createIcon("loading");
export const RefreshCw = createIcon("refresh");
export const Send = createIcon("send");
export const Settings = createIcon("settings");
export const Account = createIcon("account");

export const interfaceIcons = {
  "objects": FolderKanban,
  "building": Building2,
  "inspection": ShieldCheck,
  "review": FileSearch,
  "protocol": FileCheck2,
  "catalog": BookOpen,
  "document": FileText,
  "history": FileClock,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up-right": ArrowUpRight,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "menu": Menu,
  "panel-collapse": PanelLeftClose,
  "close": X,
  "upload": UploadCloud,
  "download": Download,
  "search": Search,
  "filter": Filter,
  "adjustments": SlidersHorizontal,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  "plus": Plus,
  "check": Check,
  "success": CheckCircle2,
  "warning": AlertTriangle,
  "error": XCircle,
  "loading": LoaderCircle,
  "refresh": RefreshCw,
  "send": Send,
  "settings": Settings,
  "account": Account,
} as const;
