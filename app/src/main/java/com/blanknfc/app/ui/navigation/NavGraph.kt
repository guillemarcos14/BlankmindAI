package com.blanknfc.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.blanknfc.app.data.HealthConnectStore
import com.blanknfc.app.data.OnboardingSyncStore
import com.blanknfc.app.data.PlayPurchaseStore
import com.blanknfc.app.data.ReferralStore
import com.blanknfc.app.data.SessionManager
import com.blanknfc.app.ui.screens.AppSelectorScreen
import com.blanknfc.app.ui.screens.ForgetNfcScreen
import com.blanknfc.app.ui.screens.HomeScreen
import com.blanknfc.app.ui.screens.PrivacyScreen
import com.blanknfc.app.ui.screens.RelinkNfcScreen
import com.blanknfc.app.ui.screens.SetupScreen

object Routes {
    const val SETUP = "setup"
    const val HOME = "home"
    const val APP_SELECTOR = "app_selector"
    const val PRIVACY = "privacy"
    const val RELINK_NFC = "relink_nfc"
    const val FORGET_NFC = "forget_nfc"
}

@Composable
fun NavGraph(
    navController: NavHostController,
    sessionManager: SessionManager,
    purchaseStore: PlayPurchaseStore,
    healthConnectStore: HealthConnectStore,
    onboardingSyncStore: OnboardingSyncStore,
    referralStore: ReferralStore,
    startDestination: String
) {
    NavHost(navController = navController, startDestination = startDestination) {
        composable(Routes.SETUP) {
            SetupScreen(
                sessionManager = sessionManager,
                purchaseStore = purchaseStore,
                onboardingSyncStore = onboardingSyncStore,
                onSetupComplete = {
                    sessionManager.setSetupComplete()
                    navController.navigate(Routes.HOME) {
                        popUpTo(Routes.SETUP) { inclusive = true }
                    }
                },
                onSelectApps = {
                    navController.navigate(Routes.APP_SELECTOR)
                },
                onNavigateToPrivacy = {
                    navController.navigate(Routes.PRIVACY)
                }
            )
        }
        composable(Routes.HOME) {
            HomeScreen(
                sessionManager = sessionManager,
                purchaseStore = purchaseStore,
                healthConnectStore = healthConnectStore,
                referralStore = referralStore,
                onRelinkTag = {
                    navController.navigate(Routes.RELINK_NFC)
                },
                onForgetTag = {
                    navController.navigate(Routes.FORGET_NFC)
                }
            )
        }
        composable(Routes.APP_SELECTOR) {
            AppSelectorScreen(
                sessionManager = sessionManager,
                onBack = { navController.popBackStack() }
            )
        }
        composable(Routes.PRIVACY) {
            PrivacyScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.RELINK_NFC) {
            RelinkNfcScreen(
                sessionManager = sessionManager,
                onBack = { navController.popBackStack() }
            )
        }
        composable(Routes.FORGET_NFC) {
            ForgetNfcScreen(
                onConfirm = {
                    sessionManager.forgetNfcTag()
                    navController.navigate(Routes.SETUP) {
                        popUpTo(Routes.HOME) { inclusive = true }
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }
    }
}
