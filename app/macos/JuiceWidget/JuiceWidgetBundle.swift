import SwiftUI
import WidgetKit

/// The extension's entry point, in a file of its own so the widget's views stay
/// free of `@main` and can be rendered elsewhere.
@main
struct JuiceWidgetBundle: WidgetBundle {
  var body: some Widget {
    BatteryWidget()
  }
}
