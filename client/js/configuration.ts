// Static, client-built configuration.
//
// TheLounge received this object from its Node server on every connection
// (`configuration` socket event). Seance has no such server, so the values
// are baked in at build time. Per-deployment values (app name, default
// network, default theme) come from `config.json` instead — see
// `client/js/branding.ts`; `boot.ts` folds `branding.theme` into
// `defaultTheme` below before the store sees this object, and turns on
// `fileUpload` (with `fileUploadMaxFileSize`) when `branding.uploads` names
// an uploader endpoint.

import pkg from "../../package.json";
import type {SharedConfiguration} from "../../shared/types/config";

const configuration: SharedConfiguration = {
	public: false,
	useHexIp: false,
	prefetch: false,
	// Off unless config.json provides `uploads` (see boot.ts).
	fileUpload: false,
	ldapEnabled: false,
	isUpdateAvailable: false,
	applicationServerKey: "",
	// The build's name, the release it is or follows, and the commit it was
	// made from — filled in by webpack (`resolveBuild`); Help links them.
	version: process.env.SEANCE_VERSION || pkg.version,
	release: process.env.SEANCE_RELEASE || pkg.version,
	gitCommit: process.env.SEANCE_COMMIT || null,
	// One CSS file each under client/themes/; docs/resources/themes.md. The
	// four handoff themes (Ink & Amber, Cobalt Frost) carry their titlebar
	// tone as the browser chrome colour, the older two leave it to the
	// deploy's themeColor.
	themes: [
		{name: "coffee", displayName: "Coffee", themeColor: "#1a1816"},
		{name: "creama", displayName: "Creama", themeColor: "#efe9de"},
		{name: "cobalt", displayName: "Cobalt", themeColor: "#101720"},
		{name: "frost", displayName: "Frost", themeColor: "#eef2f7"},
		{name: "molokai", displayName: "Molokai", themeColor: "#1b1d1e"},
		{name: "day", displayName: "Day", themeColor: null},
		{name: "morning", displayName: "Morning", themeColor: null},
	],
	defaultTheme: "coffee",
	lockNetwork: false,
	defaults: {
		name: "",
		host: "",
		port: 6697,
		password: "",
		tls: true,
		rejectUnauthorized: true,
		nick: "",
		username: "",
		realname: "",
		join: "",
		leaveMessage: "",
		sasl: "",
		saslAccount: "",
		saslPassword: "",
	},
};

export default configuration;
