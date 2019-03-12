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


const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Clutter = imports.gi.Clutter;
const PanelMenu = imports.ui.panelMenu;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const GLib = imports.gi.GLib;

const Gettext = imports.gettext.domain('hamster-shell-extension');
const _ = Gettext.gettext;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const FactsBox = Me.imports.widgets.factsBox.FactsBox;
const Stuff = Me.imports.stuff;

/**
 * Class that defines the actual extension widget to be shown in the panel.
 *
 *  -------------------------------------------------------------
 *  | Gnome top menu bar  | PanelWidget / PanelWidget.panelLabel|
 *  -------------------------------------------------------------
 *                        |PanelWidget.menu                     |
 *                        |                                     |
 *                        |PanelWidget.factsBox                 |
 *                        |                                     |
 *                        |PanelWidget.overviewMenuItem         |
 *                        |PanelWidget.stopTrackingMenuItem     |
 *                        |PanelWidget.addNewFactMenuItem       |
 *                        |PanelWidget.SettingMenuItem          |
 *                        |                                     |
 *                        ---------------------------------------
 *
 * @class
 */
var PanelWidget = GObject.registerClass(
class PanelWidget extends PanelMenu.Button {
    _init(controller) {
        // [FIXME]
        // What is the parameter?
        super._init(0.0);

        this._controller = controller;
        // [FIXME]
        // Still needed?
        this._extensionMeta = controller.extensionMeta;
        this._settings = controller.settings;
        this._windowsProxy = controller.windowsProxy;

        controller.apiProxy.connectSignal('FactsChanged',      this.refresh.bind(this));
        controller.apiProxy.connectSignal('TagsChanged',       this.refresh.bind(this));


        // Setup the main layout container for the part of the extension
        // visible in the panel.
        let panelContainer = new St.BoxLayout({style_class: "panel-box"});

	let _actor = (this instanceof Clutter.Actor ? this : this.actor);
        _actor.add_actor(panelContainer);
        _actor.add_style_class_name('panel-status-button');

        this.panelLabel = new St.Label({
            text: _("Loading..."),
            y_align: Clutter.ActorAlign.CENTER
        });

        // If we want to switch icons, we actually keep the same instance and
        // just swap the actual image.
        // [FIXME]
        // Is there no path manipulation lib?
        this._trackingIcon = Gio.icon_new_for_string(this._extensionMeta.path + "/images/hamster-tracking-symbolic.svg");
        this._idleIcon = Gio.icon_new_for_string(this._extensionMeta.path + "/images/hamster-idle-symbolic.svg");
        this.icon = new St.Icon({gicon: this._trackingIcon,
                                 icon_size: 16,
                                 style_class: "panel-icon"});

        panelContainer.add(this.icon);
        panelContainer.add(this.panelLabel);

        this._panelContainer = panelContainer;

        this.factsBox = new FactsBox(controller, this);
        this.menu.addMenuItem(this.factsBox);

        // overview
        let overviewMenuItem = new PopupMenu.PopupMenuItem(_("Show Overview"));
        overviewMenuItem.connect('activate', this._onOpenOverview.bind(this));
        this.menu.addMenuItem(overviewMenuItem);

        // [FIXME]
        // This should only be shown if we have an 'ongoing fact'.
        // stop tracking
        let stopTrackinMenuItem = new PopupMenu.PopupMenuItem(_("Stop Tracking"));
        stopTrackinMenuItem.connect('activate', this._onStopTracking.bind(this));
        this.menu.addMenuItem(stopTrackinMenuItem);

        // add new task
        let addNewFactMenuItem = new PopupMenu.PopupMenuItem(_("Add Earlier Activity"));
        addNewFactMenuItem.connect('activate', this._onOpenAddFact.bind(this));
        this.menu.addMenuItem(addNewFactMenuItem);

        // settings
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        let SettingMenuItem = new PopupMenu.PopupMenuItem(_("Tracking Settings"));
        SettingMenuItem.connect('activate', this._onOpenSettings.bind(this));
        this.menu.addMenuItem(SettingMenuItem);

        // focus menu upon display
        this.menu.connect('open-state-changed',
            function(menu, open) {
                if (open) {
                    this.factsBox.focus();
                } else {
                    this.factsBox.unfocus();
                }
            }.bind(this)
        );

        // refresh the widget every 60 secs
        this.timeout = GLib.timeout_add_seconds(0, 60, this.refresh.bind(this));
        this.connect('destroy', this._disableRefreshTimer.bind(this));
        this.refresh();
    }

    /**
     * This is our main 'update/refresh' method.
     * Whenever we suspect that things have changed (via dbus signals)
     * this should be triggered.
     * Upon such triggering, this method should call relevant sub-widget's
     * 'refresh' method.
     * As such it should do as little work as possible and rather gather all
     * required facts etc and pass them to the relevant sub-widget's
     * refresh methods.
     */
    refresh() {
    /**
     * We need to wrap our actual refresh code in this callback for now as
     * I am having major difficulties using a syncronous dbus method call to
     * fetch the array of 'todaysFacts'.
     */
	function _refresh([response], err) {
        /**
         * Extract *ongoing fact* from our list of facts. Due to how *legacy
         * hamster* works this is the first element in the array returned my
         * ``getTodayFacts``.
         *
         * Returns ``null`` if there is no *ongoing fact*.
         */
        /* jshint validthis: true */
		function getOngoingFact(facts) {
		    let result = null;
		    if (facts.length) {
			let lastFact = facts[facts.length - 1];
			if (!lastFact.endTime) { result = lastFact; }
		    }
		    return result;
		}

		let facts = [];

        // [FIXME]
        // This seems a rather naive way to handle potential errors.
		if (err) {
		    log(err);
		} else if (response.length > 0) {
		    facts = Stuff.fromDbusFacts(response);
		}

		let ongoingFact = getOngoingFact(facts);

		this.updatePanelDisplay(ongoingFact);
		this.factsBox.refresh(facts, ongoingFact);
	}

    // [FIXME]
    // This should really be a synchronous call fetching the facts.
    // Once this is done, the actual code from the callback should follow
    // here.
    this._controller.apiProxy.GetTodaysFactsRemote(_refresh.bind(this));

    this._controller.apiProxy.GetFactsRemote(this._startOfWeek(),
                                             this._endOfWeek(),
                                             "",
                                             ([response], err) => {
	let facts = [];

	if (err) {
		log(err);
	} else if (response.length > 0) {
		facts = Stuff.fromDbusFacts(response);
	}

	let totalWeek = 0;
	for (var fact of facts) {
		totalWeek += fact.delta;
	}

	this.setWeekTimeDone(totalWeek);
    });

    return GLib.SOURCE_CONTINUE;
    }

    /**
     * Get begin of current week.
     */
    _startOfWeek() {
        var dt = new Date(); // current date of week
        var currentWeekDay = dt.getDay();
        var lessDays = currentWeekDay == 0 ? 6 : currentWeekDay - 1;
        var wkStart = new Date(new Date(dt).setDate(dt.getDate() - lessDays));
        wkStart.setUTCHours(0,0,0,0)
        return Math.floor(wkStart.getTime() / 1000)
    }

    /**
     * Get end of current week.
     */
    _endOfWeek() {
        var dt = new Date(); // current date of week
        var currentWeekDay = dt.getDay();
        var lessDays = currentWeekDay == 0 ? 6 : currentWeekDay - 1;
        var wkStart = new Date(new Date(dt).setDate(dt.getDate() - lessDays));
        var wkEnd = new Date(new Date(wkStart).setDate(wkStart.getDate() + 6));
        wkEnd.setUTCHours(23, 59, 59, 0);
        return Math.floor(wkEnd.getTime() / 1000);
    }

    /**
     * Get end of current day.
     */
    _endOfToday() {
        let now = new Date();
        now.setUTCHours(23, 59, 59, 0);
        return Math.floor(now.getTime() / 1000);
    }

    /**
     * Open 'popup menu' containing the bulk of the extension widgets.
     */
    show() {
        this.menu.open();
    }

    /**
     * Close/Open the 'popup menu' depending on previous state.
     */
    toggle() {
        this.menu.toggle();
    }


    /**
     * Change style when time is complete.
     */
    isTimeDone(totalTime, timeLimit, styleClass) {
        if (totalTime >= timeLimit) {
            this._panelContainer.add_style_class_name(styleClass);
            return true;
        } else {
            this._panelContainer.remove_style_class_name(styleClass);
            return false;
        }
    }

    /**
     * Change style when day is complete.
     */
    setDayTimeDone(totalTime) {
        const hoursPerDay = this._settings.get_double("hours-per-day");
        this.isTimeDone(totalTime, hoursPerDay * 60 * 60, 'panel-box-daydone');
        if (totalTime >= hoursPerDay * 60 * 60) {
            this._controller.apiProxy.GetFactsRemote(this._startOfWeek(),
                                                     this._endOfToday(),
                                                     "",
                                                     ([response], err) => {
                   let facts = [];

                   if (err) {
                       log(err);
                   } else if (response.length > 0) {
                       facts = Stuff.fromDbusFacts(response);
                   }

                   let currentWeek = 0;
                   for (var fact of facts) {
                       currentWeek += fact.delta;
                   }

                   let weekOfDay = new Date().getDay();
                   // Set Sunday as 7
                   if (weekOfDay == 0) {
                       weekOfDay = 7;
                   }

                   const hoursPerDay = this._settings.get_double("hours-per-day");
                   this.isTimeDone(weekOfDay * hoursPerDay * 60 * 60, currentWeek, 'panel-box-daydoneweeknot');
            });
        }
    }

    /**
     * Change style when week is complete.
     */
    setWeekTimeDone(totalTime) {
        const hoursPerDay = this._settings.get_double("hours-per-day");
        const daysPerWeek = this._settings.get_double("days-per-week");
        this.isTimeDone(totalTime, daysPerWeek * hoursPerDay * 60 * 60, 'panel-box-weekdone');
    }

    /**
     * Update the rendering of the PanelWidget in the panel itself.
     *
     * Depending on the 'display mode' set in the extensions settings this has
     * slightly different consequences.
     */
    updatePanelDisplay(fact) {
        /**
         * Return a text string representing the passed fact suitable for the panelLabel.
         *
         * @param fact The fact to be represented. Be advised. If there is no
         * *ongoing fact* this will be ``null``!
         */
        function getLabelString(fact) {
            let result = _("No activity");
            if (fact) {
                result = "%s %s".format(fact.name, Stuff.formatDuration(fact.delta));
            }
            return result;
        }
        /**
         * Returns the appropriate icon image depending on ``fact``.
         */
        function getIcon(panelWidget) {
            let result = panelWidget._idleIcon;
            if (fact) { result = panelWidget._trackingIcon; }
            return result;
        }

        // 0 = show label, 1 = show just icon, 2 = show label and icon
        switch (this._settings.get_int("panel-appearance")) {
            case 0:
                this.panelLabel.set_text(getLabelString(fact));
                this.panelLabel.show();
                this.icon.hide();
                break;
            case 1:
                this.icon.gicon = getIcon(this);
                this.icon.show();
                this.panelLabel.hide();
                break;
            case 2:
                this.icon.gicon = getIcon(this);
                this.icon.show();
                this.panelLabel.set_text(getLabelString(fact));
                this.panelLabel.show();
                break;
        }
    }

    /**
     * Disable the refresh timer.
     *
     * @callback panelWidget~_disableRefreshTimer
     *
     * This method is actually a callback triggered on the destroy
     * signal.
     */
    _disableRefreshTimer() {
        GLib.source_remove(this.timeout);
    }

    /**
     * Callback to be triggered when an *ongoing fact* is stopped.
     * @callback PanelWidget~_onStopTracking
     *
     * This will get the current time and issue the ``StopTracking``
     * method call to the dbus interface.
     */
    _onStopTracking() {
        let now = new Date();
        let epochSeconds = Date.UTC(now.getFullYear(),
                                    now.getMonth(),
                                    now.getDate(),
                                    now.getHours(),
                                    now.getMinutes(),
                                    now.getSeconds());
        epochSeconds = Math.floor(epochSeconds / 1000);
        this._controller.apiProxy.StopTrackingRemote(GLib.Variant.new('i', [epochSeconds]));
    }

    /**
     * Callback that triggers opening of the *Overview*-Window.
     *
     * @callback panelWidget~_onOpenOverview
     */
    _onOpenOverview() {
        this._controller.windowsProxy.overviewSync();
    }

    /**
     * Callback that triggers opening of the *Add Fact*-Window.
     *
     * @callback panelWidget~_onOpenAddFact
     */
    _onOpenAddFact() {
        this._controller.windowsProxy.editSync(GLib.Variant.new('i', [0]));
    }

    /**
     * Callback that triggers opening of the *Add Fact*-Window.
     *
     * @callback panelWidget~_onOpenSettings
     *
     * Note: This will open the GUI settings, not the extension settings!
     */
    _onOpenSettings() {
        this._controller.windowsProxy.preferencesSync();
    }
});
