/*
This file is part of 'hamster-shell-extension'.

'hamster-shell-extension' is free software: you can redistribute it and/or
modify it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

'hamster-shell-extension' is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with 'hamster-shell-extension'.  If not, see <http://www.gnu.org/licenses/>.

Copyright (c) 2011 Jerome Oufella <jerome@oufella.com>
Copyright (c) 2011-2012 Toms Baugis <toms.baugis@gmail.com>
Icons Artwork Copyright (c) 2012 Reda Lazri <the.red.shortcut@gmail.com>
Copyright (c) 2016 - 2018 Eric Goller / projecthamster <elbenfreund@projecthamster.org>
*/


const GLib = imports.gi.GLib;
const Shell = imports.gi.Shell;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;

const Gettext = imports.gettext.domain('hamster-shell-extension');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const PanelWidget = Me.imports.widgets.panelWidget.PanelWidget;

// dbus-send --session --type=method_call --print-reply --dest=org.gnome.Hamster /org/gnome/Hamster org.freedesktop.DBus.Introspectable.Introspect
const ApiProxyIface = ['',
  '<node>',
  '  <interface name="org.gnome.Hamster">',
  '    <method name="GetTodaysFacts">',
  '      <arg direction="out" type="a(iiissisasii)" />',
  '    </method>',
  '    <method name="GetFacts">',
  '      <arg direction="in" type="u" name="start_time" />',
  '      <arg direction="in" type="u" name="end_time" />',
  '      <arg direction="in" type="s" name="search_terms" />',
  '      <arg direction="out" type="a(iiissisasii)" />',
  '    </method>',
  '    <method name="StopTracking">',
  '      <arg direction="in"  type="v" name="end_time" />',
  '    </method>',
  '    <method name="AddFact">',
  '      <arg direction="in"  type="s" name="fact" />',
  '      <arg direction="in"  type="i" name="start_time" />',
  '      <arg direction="in"  type="i" name="end_time" />',
  '      <arg direction="in"  type="b" name="temporary" />',
  '      <arg direction="out" type="i" />',
  '    </method>',
  '    <method name="GetActivities">',
  '      <arg direction="in"  type="s" name="search" />',
  '      <arg direction="out" type="a(ss)" />',
  '    </method>',
  '    <signal name="FactsChanged"></signal>',
  '    <signal name="ActivitiesChanged"></signal>',
  '    <signal name="TagsChanged"></signal>',
  '  </interface>',
  '</node>',
].join('');

let ApiProxy = Gio.DBusProxy.makeProxyWrapper(ApiProxyIface);

// dbus-send --session --type=method_call --print-reply --dest=org.gnome.Hamster.WindowServer /org/gnome/Hamster/WindowServer org.freedesktop.DBus.Introspectable.Introspect
const WindowsProxyIface = ['',
  '<node>',
  '  <interface name="org.gnome.Hamster.WindowServer">',
  '    <method name="edit">',
  '      <arg direction="in"  type="v" name="id" />',
  '    </method>',
  '    <method name="overview"></method>',
  '    <method name="preferences"></method>',
  '  </interface>',
  '</node>',
].join('');


let WindowsProxy = Gio.DBusProxy.makeProxyWrapper(WindowsProxyIface);


/**
 * Create the controller instance that handles extension context.
 *
 * This class does not actually handle any widgets/representation itself. It is
 * instead in charge of setting up the general infrastructure and to make sure
 * that the extension cleans up after itself if it gets deactivated.
 *
 * @class
 */
class Controller {
    constructor(extensionMeta) {
	let dateMenu = Main.panel.statusArea.dateMenu;

        this.settings = ExtensionUtils.getSettings();
        this.extensionMeta = extensionMeta;
        this.dbusConnection = null;
        this.dbusConnectionMaxRetries = 30;
        this.panelWidget = null;
        this.placement = 0;
        this.apiProxy = null;
        this.windowsProxy = null;
        this.apiProxy_watcher = 0;
        this.windowsProxy_watcher = 0;
        this.apiProxyActive = false;
        this.windowsProxyActive = false;
        this.apiProxyActivitiesChangedId = 0;
        this.extensionEnabled = false;
    }

    /**
     * 'Magic' method, called upon extension launch.
     *
     * The gnome-shell-extension API grantees that there is always a ``disable`` call in
     * between to ``enable`` calls.
     *
     * Note:
     *  We only set up our dbus proxies here. In order to be able to do so asynchronously all
     *  the actual startup code is refered to ``deferred_enable``.
     */
    enable() {
        this.extensionEnabled = true;
        this.run_enable();
    }

    run_enable() {
        if (!this.extensionEnabled)
            return;

        if (this.settings.get_boolean("enable-custom-dbus")) {
            Gio.DBusConnection.new_for_address(this.settings.get_string("custom-dbus"),
                                               Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
                                               Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
                                               null, null,
                                               function(connection) {
                                                   this.dbusConnection = connection;
                                                   if (!this.dbusConnection.get_unique_name()) {
                                                       global.log("hamster-shell-extension: connection is not ready ; retrying in 10 seconds");
                                                       GLib.timeout_add_seconds(0, 10,
                                                                                function() {
                                                                                    this.dbusConnectionMaxRetries = this.dbusConnectionMaxRetries - 1;
                                                                                    if (this.dbusConnectionMaxRetries > 0)
                                                                                        this.run_enable();
                                                                                    return 0;
                                                                                }.bind(this));
                                                       return;
                                                   }
                                                   new ApiProxy(this.dbusConnection,
                                                                'org.gnome.Hamster',
                                                                '/org/gnome/Hamster',
                                                                function(proxy) {
	                                                            this.apiProxy = proxy;
                                                                    this.apiProxyActive = true;
                                                                    this.deferred_enable();
                                                                }.bind(this));
                                                   new WindowsProxy(this.dbusConnection,
                                                                    'org.gnome.Hamster.WindowServer',
                                                                    '/org/gnome/Hamster/WindowServer',
			                                            function(proxy) {
			                                                this.windowsProxy = proxy;
                                                                        this.windowsProxyActive = true;
			                                                this.deferred_enable();
			                                            }.bind(this));
                                               }.bind(this));

        } else {
            this.dbusConnection = Gio.DBus.session;
            new ApiProxy(this.dbusConnection, 'org.gnome.Hamster', '/org/gnome/Hamster',
                         function(proxy) {
	                     this.apiProxy = proxy;
                             this.apiProxyActive = true;
                             this.deferred_enable();
                         }.bind(this));
            new WindowsProxy(this.dbusConnection, 'org.gnome.Hamster.WindowServer', '/org/gnome/Hamster/WindowServer',
			     function(proxy) {
			         this.windowsProxy = proxy;
                                 this.windowsProxyActive = true;
			         this.deferred_enable();
			     }.bind(this));
        }
    }

    deferred_enable() {
        // Make sure ``enable`` is 'finished' and ``disable`` has not been
        // called in between.
        if (!this.extensionEnabled || !this.apiProxyActive || !this.windowsProxyActive)
            return;

        this._addPanelWidget();
        this._setWatchers();
        
        this.refreshActivities();

    }

    disable() {
        global.log('Shutting down hamster-shell-extension.');
        this.extensionEnabled = false;
        this.run_disable();
        this.apiProxyActive = false;
        this.windowsProxyActive = false;
        this.apiProxy = null;
        this.windowsProxy = null;
        this.dbusConnectionMaxRetries = 30;
    }

    run_disable() {
        this._removePanelWidget();
    }

    _setWatchers() {
        // Callbacks that handle appearing/vanishing dbus services.
        function apiProxy_appeared_callback() {
            global.log(_("hamster-shell-extension: 'hamster-service' running again.. Shutting up."));
            this.apiProxyActive = true;
            this.deferred_enable();
        }

        function apiProxy_vanished_callback() {
	    /* jshint validthis: true */
            global.log(_("hamster-shell-extension: 'hamster-service' not running. Shutting down."));
            Main.notify(_("hamster-shell-extension: 'hamster-service' not running. Shutting down."));
            this.apiProxyActive = false;
            this.run_disable();
        }

        function windowsProxy_appeared_callback() {
            global.log(_("hamster-shell-extension: 'hamster-windows-service' running again.. Shutting up."));
            this.windowsProxyActive = true;
            this.deferred_enable();
        }

        function windowsProxy_vanished_callback() {
	    /* jshint validthis: true */
            global.log(_("hamster-shell-extension: 'hamster-windows-service' not running. Shutting down."));
            Main.notify(_("hamster-shell-extension: 'hamster-windows-service' not running. Shutting down."));
            this.windowsProxyActive = false;
            this.run_disable();
        }

        // Set-up watchers that watch for required dbus services.
        if (!this.apiProxy_watcher)
            this.apiProxy_watcher = Gio.bus_watch_name_on_connection(this.dbusConnection, 'org.gnome.Hamster',
	                                                             Gio.BusNameWatcherFlags.NONE, apiProxy_appeared_callback.bind(this),
	 				                             apiProxy_vanished_callback.bind(this));

        if (!this.windowsProxy_watcher)
            this.windowsProxy_watcher = Gio.bus_watch_name_on_connection(this.dbusConnection, 'org.gnome.Hamster.WindowServer',
	 					                         Gio.BusNameWatcherFlags.NONE, windowsProxy_appeared_callback.bind(this),
	 					                         windowsProxy_vanished_callback.bind(this));
    }
    
    _unsetWatchers() {
        if (this.apiProxy_watcher) {
            Gio.bus_unwatch_name(this.apiProxy_watcher);
            this.apiProxy_watcher = 0;
        }
        if (this.windowsProxy_watcher) {
            Gio.bus_unwatch_name(this.windowsProxy_watcher);
            this.windowsProxy_watcher = 0;
        }
    }

    /**
     * Build a new cache of all activities present in the backend.
     */
    refreshActivities() {
        if (this.runningActivitiesQuery) {
            return(this.activities);
        }

        this.runningActivitiesQuery = true;
        this.apiProxy.GetActivitiesRemote("", function([response], err) {
            this.runningActivitiesQuery = false;
            this.activities = response;
        }.bind(this));
    }

    _addPanelWidget() {
        if (!this.panelWidget) {
            this.panelWidget = new PanelWidget(this);
            this.placement = this.settings.get_int("panel-placement");
            this._placeWidget(this.placement, this.panelWidget);

            Main.panel.menuManager.addMenu(this.panelWidget.menu);

            Main.wm.addKeybinding("show-hamster-dropdown",
			          this.panelWidget._settings,
			          Meta.KeyBindingFlags.NONE,
			          // Since Gnome 3.16, Shell.KeyBindingMode is replaced by Shell.ActionMode
			          Shell.KeyBindingMode ? Shell.KeyBindingMode.ALL : Shell.ActionMode.ALL,
			          this.panelWidget.toggle.bind(this.panelWidget)
			         );
            this.apiProxyActivitiesChangedId = this.apiProxy.connectSignal('ActivitiesChanged', this.refreshActivities.bind(this));
        }
    }

    _removePanelWidget() {
        if (this.panelWidget) {
            Main.wm.removeKeybinding("show-hamster-dropdown");
            this._removeWidget(this.placement);
            Main.panel.menuManager.removeMenu(this.panelWidget.menu);
            this.panelWidget.destroy();
            this.panelWidget = null;

            this.apiProxy.disconnectSignal(this.apiProxyActivitiesChangedId);
            this.apiProxyActivitiesChangedId = 0;
        }
    }

    /**
     * Place the actual extension wi
     * get in the right place according to settings.
     */
    _placeWidget(placement, panelWidget) {
        if (placement == 1) {
            // 'Replace calendar'
            Main.panel.addToStatusArea("hamster", this.panelWidget, 0, "center");

            Main.panel._centerBox.remove_actor(dateMenu.container);
            Main.panel._addToPanelBox('dateMenu', dateMenu, -1, Main.panel._rightBox);
        } else if (placement == 2) {
            // 'Replace activities'
            let activitiesMenu = Main.panel._leftBox.get_children()[0].get_children()[0].get_children()[0].get_children()[0];
            // If our widget replaces the 'Activities' menu in the panel,
            // this property stores the original text so we can restore it
            // on ``this.disable``.
            this._activitiesText = activitiesMenu.get_text();
            activitiesMenu.set_text('');
            Main.panel.addToStatusArea("hamster", this.panelWidget, 1, "left");
        } else {
            // 'Default'
            Main.panel.addToStatusArea("hamster", this.panelWidget, 0, "right");
        }
    }

    _removeWidget(placement) {
        if (placement == 1) {
            // We replaced the calendar
            Main.panel._rightBox.remove_actor(dateMenu.container);
            Main.panel._addToPanelBox(
                'dateMenu',
                dateMenu,
                Main.sessionMode.panel.center.indexOf('dateMenu'),
                Main.panel._centerBox
            );
            Main.panel._centerBox.remove_actor(this.panelWidget.container);
        } else if (placement == 2) {
            // We replaced the 'Activities' menu
            let activitiesMenu = Main.panel._leftBox.get_children()[0].get_children()[0].get_children()[0].get_children()[0];
            activitiesMenu.set_text(this._activitiesText);
            Main.panel._leftBox.remove_actor(this.panelWidget.container);
        }
    }
}


function init(extensionMeta) {
    ExtensionUtils.initTranslations();
    return new Controller(extensionMeta);
}
