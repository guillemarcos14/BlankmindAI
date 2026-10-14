package com.blanknfc.app

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import com.blanknfc.app.analytics.NetlifyAnalyticsTracker
import com.blanknfc.app.data.BlankBackendClient
import com.blanknfc.app.data.HealthConnectStore
import com.blanknfc.app.data.OnboardingSyncStore
import com.blanknfc.app.data.PlayPurchaseStore
import com.blanknfc.app.data.ReferralStore
import com.blanknfc.app.data.SessionManager

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "blank_prefs")

class AppContainer(context: Context) {
    val backendClient = BlankBackendClient(context)
    val analyticsTracker = NetlifyAnalyticsTracker(backendClient)
    val sessionManager = SessionManager(context.dataStore, analyticsTracker = analyticsTracker)
    val purchaseStore = PlayPurchaseStore(context)
    val healthConnectStore = HealthConnectStore(context)
    val onboardingSyncStore = OnboardingSyncStore(backendClient)
    val referralStore = ReferralStore(context, backendClient)
}
